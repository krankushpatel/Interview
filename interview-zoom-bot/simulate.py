"""End-to-end simulation WITHOUT Zoom/Recall.

Start the server in mock mode first:   uvicorn app.main:app --port 8000
Then run:                               python simulate.py

It plays a fake student by POSTing Recall-shaped webhook events to /webhook/recall,
and asserts the state machine, commands, stale-speech filter, timer auto-submit and WS feed.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys

import httpx
import websockets

BASE = os.getenv("BASE", "http://127.0.0.1:8000")
TOKEN = os.getenv("WEBHOOK_TOKEN", "dev-webhook-token")
KEY = os.getenv("ADMIN_KEY", "")
STUDENT = {"id": 101, "name": "Test Student", "is_host": False}
ADMIN = {"id": 1, "name": "Admin", "is_host": True}

fails: list[str] = []


def check(name: str, cond: bool, extra: str = "") -> None:
    print(("PASS  " if cond else "FAIL  ") + name + (f"   [{extra}]" if (extra and not cond) else ""))
    if not cond:
        fails.append(name)


def words(text: str, start: float, step: float = 0.4) -> list[dict]:
    out = []
    for i, w in enumerate(text.split()):
        out.append({"text": w, "start_timestamp": {"relative": start + i * step},
                    "end_timestamp": {"relative": start + (i + 1) * step}})
    return out


class Sim:
    def __init__(self, c: httpx.AsyncClient, iid: str) -> None:
        self.c, self.iid = c, iid

    async def post(self, event: str, data: dict) -> None:
        body = {"event": event, "data": {"data": data, "bot": {"id": "x", "metadata": {}}}}
        r = await self.c.post(f"/webhook/recall", params={"token": TOKEN, "interview_id": self.iid}, json=body)
        r.raise_for_status()
        await asyncio.sleep(0.05)

    async def join(self, p: dict) -> None:
        await self.post("participant_events.join", {"participant": p, "timestamp": {"relative": 1.0}, "data": None})

    async def chat(self, p: dict, text: str, rel: float) -> None:
        await self.post("participant_events.chat_message", {
            "participant": p, "timestamp": {"relative": rel}, "data": {"text": text, "to": "everyone"}})

    async def say(self, text: str, start: float, final: bool, p: dict = STUDENT) -> None:
        await self.post("transcript.data" if final else "transcript.partial_data",
                        {"words": words(text, start), "participant": p, "language_code": "en"})

    async def snap(self) -> dict:
        r = await self.c.get(f"/api/interviews/{self.iid}", params={"key": KEY})
        r.raise_for_status()
        return r.json()


async def collect_ws(iid: str, sink: list) -> None:
    url = BASE.replace("http", "ws") + f"/ws/admin?interview_id={iid}&key={KEY}"
    try:
        async with websockets.connect(url) as ws:
            async for msg in ws:
                sink.append(json.loads(msg))
    except Exception:
        pass


async def main() -> int:
    async with httpx.AsyncClient(base_url=BASE, timeout=20) as c:
        h = (await c.get("/api/health", params={"key": KEY})).json()
        print("server:", h)
        check("server is in mock mode", h["mode"] == "mock")

        # 3 questions, default limit 8s (warn at 2s before end), Q2 has its own limit
        r = await c.post("/api/interviews", params={"key": KEY}, json={
            "candidate_name": "Test Student", "meeting_url": "mock://meeting", "time_limit_sec": 8,
            "questions": ["Tell me about yourself.", {"text": "What is a Python tuple?", "time_limit_sec": 30}, "Why this role?"]})
        r.raise_for_status()
        iid = r.json()["id"]
        check("interview created with per-question limits",
              [q["time_limit_sec"] for q in r.json()["questions"]] == [8, 30, 8])

        ws_msgs: list = []
        ws_task = asyncio.create_task(collect_ws(iid, ws_msgs))
        await asyncio.sleep(0.4)
        sim = Sim(c, iid)

        # --- join + welcome ---------------------------------------------------
        await sim.join({"id": 7, "name": "Interviewer", "is_host": False})  # the bot itself: ignored
        await sim.join(ADMIN)
        s = await sim.snap()
        check("bot/admin joining does not trigger welcome", not any("Welcome" in m["text"] for m in s["chat_log"]))
        await sim.join(STUDENT)
        s = await sim.snap()
        check("welcome message sent on student join", any("Welcome" in m["text"] and m["direction"] == "bot" for m in s["chat_log"]))

        # speech before /start must be ignored
        await sim.say("this should be ignored", 2.0, True)
        check("status waiting before /start", s["status"] == "waiting")

        # admin typing /start must not start it
        await sim.chat(ADMIN, "/start", 3.0)
        check("host cannot /start", (await sim.snap())["status"] == "waiting")

        await sim.chat(STUDENT, "/start", 5.0)
        s = await sim.snap()
        check("/start begins interview (Q1 sent)", s["status"] == "in_progress" and s["q_index"] == 0
              and any(m["text"].startswith("Q1/3") for m in s["chat_log"]))
        check("student bound by /start sender", s["student_id"] == "101")

        # --- Q1: speak, /show, /submit ---------------------------------------
        await sim.say("hello my na", 6.0, False)
        await sim.say("hello my name is ankush", 6.0, True)
        await sim.say("and i like", 9.0, False)
        s = await sim.snap()
        check("live answer shows final + partial", s["answer_so_far"] == "hello my name is ankush" and s["partial"] == "and i like")

        await sim.say("someone else talking", 9.5, True, p={"id": 55, "name": "Observer", "is_host": False})
        check("other speaker is ignored", "someone else" not in (await sim.snap())["answer_so_far"])

        await sim.chat(STUDENT, "/show", 10.0)
        await sim.chat(STUDENT, "/submit", 12.0)
        s = await sim.snap()
        a0 = s["answers"][0] if s["answers"] else {}
        check("/submit saved Q1 incl. last partial", a0.get("status") == "submitted"
              and a0.get("answer") == "hello my name is ankush and i like", str(a0))
        check("moved to Q2", s["q_index"] == 1 and any(m["text"].startswith("Q2/3") for m in s["chat_log"]))

        # stale tail of Q1 arrives AFTER submit (started before the /submit) -> must be dropped
        await sim.say("and i like python", 9.0, True)
        check("stale final from Q1 dropped", (await sim.snap())["answer_so_far"] == "")

        # --- Q2: speak, /clear, speak again, /submit --------------------------
        await sim.say("a tuple is a list", 13.0, True)
        await sim.chat(STUDENT, "/clear", 16.0)
        check("/clear empties answer", (await sim.snap())["answer_so_far"] == "")
        await sim.say("a tuple is an immutable sequence", 17.0, True)
        await sim.chat(STUDENT, "/submit", 21.0)
        s = await sim.snap()
        check("Q2 answer is only the post-/clear speech", s["answers"][1]["answer"] == "a tuple is an immutable sequence",
              str(s["answers"][1:]))

        # --- Q3: empty /submit refused, then let the timer auto-submit --------
        await sim.chat(STUDENT, "/submit", 22.0)
        s = await sim.snap()
        check("empty /submit is refused", s["q_index"] == 2 and any("No spoken answer" in m["text"] for m in s["chat_log"]))
        await sim.say("because i enjoy building", 23.0, True)
        await sim.say("and learning new things", 25.0, False)
        print("waiting for the 8s timer on Q3 ...")
        await asyncio.sleep(9.0)
        s = await sim.snap()
        check("reminder sent before the end", any("seconds left" in m["text"] for m in s["chat_log"]))
        a2 = s["answers"][2] if len(s["answers"]) > 2 else {}
        check("timer auto-submitted Q3", a2.get("status") == "auto_submitted"
              and a2.get("answer") == "because i enjoy building and learning new things", str(a2))
        check("interview completed", s["status"] == "completed")

        # skip path on a second interview
        r2 = await c.post("/api/interviews", params={"key": KEY}, json={
            "candidate_name": "Skipper", "meeting_url": "mock://m2", "questions": ["Only question?"]})
        sim2 = Sim(c, r2.json()["id"])
        await sim2.join(STUDENT)
        await sim2.chat(STUDENT, "/start", 1.0)
        await sim2.chat(STUDENT, "/skip", 2.0)
        s2 = await sim2.snap()
        check("/skip stores empty answer and completes", s2["answers"][0]["status"] == "skipped" and s2["status"] == "completed")

        # persistence
        rows = (await c.get("/api/interviews", params={"key": KEY})).json()
        check("interviews listed", len(rows) >= 2)

        # ws feed
        await asyncio.sleep(0.3)
        types = {m["type"] for m in ws_msgs}
        check("websocket feed delivered events", {"question", "answer_saved", "transcript", "chat", "completed"} <= types, str(types))
        ws_task.cancel()

        # debug endpoint
        dbg = (await c.get("/api/debug/events", params={"key": KEY})).json()
        check("raw events are captured for debugging", len(dbg) > 10)

        # bad token
        bad = await c.post("/webhook/recall", params={"token": "nope", "interview_id": iid}, json={})
        check("webhook rejects bad token", bad.status_code == 401)

    print("\n" + ("ALL CHECKS PASSED" if not fails else f"{len(fails)} CHECK(S) FAILED: {fails}"))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
