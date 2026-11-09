"""Interview state machine.

One Session per interview. Events come from Recall webhooks:
  participant_events.join / leave / chat_message, transcript.data / transcript.partial_data

Student flow in Zoom chat:   /start  ->  (speak)  ->  /submit | /skip | /clear   (+ /show /repeat /help)
Per-question timer is server-side: reminder before the end, auto-submit at the end.
"""
from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass
from typing import Any

from . import db
from .config import Settings
from .hub import Hub

log = logging.getLogger("engine")

MIN_LIMIT, MAX_LIMIT = 5, 3600


@dataclass
class Question:
    text: str
    time_limit_sec: int


# ----------------------------------------------------------------- helpers
def fmt_secs(n: int) -> str:
    m, s = divmod(max(0, int(n)), 60)
    return f"{m}:{s:02d}"


def preview(text: str, n: int = 500) -> str:
    return text if len(text) <= n else text[:n].rstrip() + "…"


def clamp_limit(v: int | None, default: int) -> int:
    return max(MIN_LIMIT, min(MAX_LIMIT, int(v if v else default)))


def _pid(p: dict[str, Any]) -> str | None:
    v = p.get("id")
    return None if v is None else str(v)


def _words_text(words: list[dict[str, Any]]) -> str:
    return " ".join((w.get("text") or "").strip() for w in words if (w.get("text") or "").strip()).strip()


def _rel(t: Any) -> float | None:
    if isinstance(t, dict) and t.get("relative") is not None:
        try:
            return float(t["relative"])
        except (TypeError, ValueError):
            return None
    return None


def _event_rel(d: dict[str, Any]) -> float | None:
    """Relative-clock time (seconds since recording start) of an event, if present."""
    r = _rel(d.get("timestamp"))
    if r is not None:
        return r
    words = d.get("words") or []
    if words:
        last = words[-1]
        return _rel(last.get("end_timestamp")) if _rel(last.get("end_timestamp")) is not None else _rel(last.get("start_timestamp"))
    return None


def _first_start(d: dict[str, Any]) -> float | None:
    words = d.get("words") or []
    return _rel(words[0].get("start_timestamp")) if words else None


# ----------------------------------------------------------------- session
class Session:
    def __init__(self, iid: str, candidate_name: str, meeting_url: str,
                 questions: list[Question], bot_id: str) -> None:
        self.id = iid
        self.candidate_name = candidate_name
        self.meeting_url = meeting_url
        self.questions = questions
        self.bot_id = bot_id
        self.status = "waiting"  # waiting | in_progress | completed | aborted
        self.q_index = -1
        self.student_id: str | None = None
        self.student_name: str | None = None
        self.student_present = False
        self.welcomed = False
        self.buffer: list[str] = []
        self.partial = ""
        self.q_started_at = 0.0
        self.deadline = 0.0
        self.last_rel: float | None = None
        self.cutoff_rel: float | None = None
        self.last_speech_at = 0.0
        self.silence_reminder_sent = False
        self.timer_task: asyncio.Task | None = None
        self.worker: asyncio.Task | None = None
        self.lock = asyncio.Lock()
        self.outbox: asyncio.Queue = asyncio.Queue()
        self.chat_log: list[dict[str, Any]] = []
        self.created_at = time.time()

    def answer_text(self) -> str:
        parts = list(self.buffer)
        if self.partial:
            parts.append(self.partial)
        return " ".join(parts).strip()

    def remaining(self) -> int:
        return max(0, int(round(self.deadline - time.time()))) if self.status == "in_progress" else 0

    def snapshot(self) -> dict[str, Any]:
        q = self.questions[self.q_index] if 0 <= self.q_index < len(self.questions) else None
        return {
            "id": self.id,
            "live": True,
            "candidate_name": self.candidate_name,
            "meeting_url": self.meeting_url,
            "bot_id": self.bot_id,
            "status": self.status,
            "q_index": self.q_index,
            "total_questions": len(self.questions),
            "question": q.text if q else None,
            "time_limit_sec": q.time_limit_sec if q else None,
            "deadline": self.deadline if self.status == "in_progress" else None,
            "remaining_sec": self.remaining(),
            "student_id": self.student_id,
            "student_name": self.student_name,
            "student_present": self.student_present,
            "answer_so_far": " ".join(self.buffer).strip(),
            "partial": self.partial,
            "questions": [{"text": x.text, "time_limit_sec": x.time_limit_sec} for x in self.questions],
            "answers": db.get_answers(self.id),
            "chat_log": self.chat_log[-80:],
            "created_at": self.created_at,
        }


# ------------------------------------------------------------------ engine
class Engine:
    def __init__(self, cfg: Settings, recall: Any, hub: Hub) -> None:
        self.cfg = cfg
        self.recall = recall
        self.hub = hub
        self.sessions: dict[str, Session] = {}

    # ---- lifecycle -------------------------------------------------
    async def create(self, candidate_name: str, meeting_url: str,
                     questions: list[tuple[str, int | None]],
                     time_limit_sec: int | None = None) -> Session:
        iid = uuid.uuid4().hex[:10]
        default = clamp_limit(time_limit_sec, self.cfg.default_time_limit_sec)
        qs = [Question(t.strip(), clamp_limit(lim, default)) for t, lim in questions if t.strip()]
        if not qs:
            raise ValueError("at least one question is required")

        bot = await self.recall.create_bot(meeting_url, iid)
        s = Session(iid, candidate_name, meeting_url, qs, str(bot["id"]))
        s.worker = asyncio.create_task(self._outbox_worker(s))
        self.sessions[iid] = s
        db.save_interview({
            "id": iid, "candidate_name": candidate_name, "meeting_url": meeting_url,
            "bot_id": s.bot_id, "status": s.status, "created_at": s.created_at,
            "questions": [{"text": q.text, "time_limit_sec": q.time_limit_sec} for q in qs],
        })
        await self.hub.publish(iid, {"type": "created"})
        log.info("interview %s created, bot %s, %d questions", iid, s.bot_id, len(qs))
        return s

    async def abort(self, s: Session, reason: str = "ended by admin") -> None:
        async with s.lock:
            if s.status in ("completed", "aborted"):
                return
            self._cancel_timer(s)
            s.status = "aborted"
            db.update_interview(s.id, status="aborted", finished_at=time.time())
            await self.hub.publish(s.id, {"type": "status", "status": "aborted", "reason": reason})
            await self._say(s, "The interview has been ended by the organiser. Thank you.")
        asyncio.create_task(self._leave_later(s))

    # ---- outgoing chat ---------------------------------------------
    async def _say(self, s: Session, text: str) -> None:
        to = s.student_id if (self.cfg.chat_mode == "dm" and s.student_id) else "everyone"
        entry = {"direction": "bot", "text": text, "ts": time.time()}
        s.chat_log.append(entry)
        del s.chat_log[:-200]
        await self.hub.publish(s.id, {"type": "chat", **entry})
        s.outbox.put_nowait((text, to))

    async def _outbox_worker(self, s: Session) -> None:
        while True:
            text, to = await s.outbox.get()
            try:
                await self.recall.send_chat(s.bot_id, text, to)
            except Exception as e:  # keep the worker alive
                log.error("send_chat failed: %s", e)
                await self.hub.publish(s.id, {"type": "error", "message": f"chat send failed: {e}"})
            finally:
                s.outbox.task_done()

    async def _leave_later(self, s: Session) -> None:
        try:
            await asyncio.wait_for(s.outbox.join(), timeout=20)
        except asyncio.TimeoutError:
            pass
        if self.cfg.auto_leave:
            try:
                await self.recall.leave(s.bot_id)
            except Exception as e:
                log.warning("bot leave failed: %s", e)
        if s.worker:
            s.worker.cancel()

    # ---- incoming events -------------------------------------------
    async def handle_event(self, s: Session, ev: dict[str, Any]) -> None:
        kind = ev.get("event", "")
        d = (ev.get("data") or {}).get("data") or {}
        p = d.get("participant") or {}
        rel = _event_rel(d)
        async with s.lock:
            if rel is not None and (s.last_rel is None or rel > s.last_rel):
                s.last_rel = rel
            if kind == "participant_events.join":
                await self._on_join(s, p)
            elif kind == "participant_events.leave":
                await self._on_leave(s, p)
            elif kind == "participant_events.chat_message":
                await self._on_chat(s, p, ((d.get("data") or {}).get("text")) or "", _rel(d.get("timestamp")))
            elif kind in ("transcript.data", "transcript.partial_data"):
                await self._on_transcript(s, kind == "transcript.data", p, d)

    def _is_bot(self, p: dict[str, Any]) -> bool:
        return (p.get("name") or "") == self.cfg.bot_name

    async def _on_join(self, s: Session, p: dict[str, Any]) -> None:
        if self._is_bot(p) or p.get("is_host"):
            return
        await self.hub.publish(s.id, {"type": "participant", "action": "join", "name": p.get("name")})
        if _pid(p) is not None and _pid(p) == s.student_id:
            s.student_present = True
        if not s.welcomed and s.status == "waiting":
            s.welcomed = True
            n, lim = len(s.questions), s.questions[0].time_limit_sec
            await self._say(
                s,
                f"👋 Welcome {s.candidate_name}! This is a spoken interview: {n} question(s), "
                f"about {fmt_secs(lim)} each. Speak your answer; it is transcribed live "
                f"(turn on Captions → Show Subtitle to see it).\n"
                f"Commands (type in this chat):  /submit  /skip  /clear\n"
                f"Type /start when you are ready.",
            )

    async def _on_leave(self, s: Session, p: dict[str, Any]) -> None:
        if self._is_bot(p) or p.get("is_host"):
            return
        if _pid(p) is not None and _pid(p) == s.student_id:
            s.student_present = False
            await self.hub.publish(s.id, {"type": "participant", "action": "leave", "name": p.get("name")})

    async def _on_transcript(self, s: Session, final: bool, p: dict[str, Any], d: dict[str, Any]) -> None:
        if s.status != "in_progress" or _pid(p) is None or _pid(p) != s.student_id:
            return
        words = d.get("words") or []
        text = _words_text(words)
        if not text:
            return
        first = _first_start(d)
        if s.cutoff_rel is not None and first is not None and first <= s.cutoff_rel:
            return  # speech from before the last submit/skip/clear: belongs to an older answer
        if final:
            s.buffer.append(text)
            s.partial = ""
        else:
            s.partial = text
        s.last_speech_at = time.time()
        await self.hub.publish(s.id, {
            "type": "transcript", "final": final, "text": text,
            "answer_so_far": s.answer_text(),
        })

    async def _on_chat(self, s: Session, p: dict[str, Any], text: str, rel: float | None) -> None:
        if self._is_bot(p):
            return
        t = (text or "").strip()
        if not t:
            return
        await self.hub.publish(s.id, {
            "type": "chat", "direction": "in", "participant": p.get("name"), "text": t, "ts": time.time(),
        })
        s.chat_log.append({"direction": "in", "participant": p.get("name"), "text": t, "ts": time.time()})
        del s.chat_log[:-200]

        if p.get("is_host") or not t.startswith("/"):
            return
        cmd = t.split()[0].lower()
        pid = _pid(p)

        if cmd == "/start":
            if s.status == "waiting":
                s.student_id, s.student_name, s.student_present = pid, p.get("name"), True
                s.status = "in_progress"
                db.update_interview(s.id, status="in_progress", student_id=pid,
                                    student_name=s.student_name, started_at=time.time())
                await self.hub.publish(s.id, {"type": "status", "status": "in_progress",
                                              "student": s.student_name})
                await self._start_question(s, 0)
            elif s.status == "in_progress" and not s.student_present and pid != s.student_id:
                # student rejoined with a new participant id
                s.student_id, s.student_name, s.student_present = pid, p.get("name"), True
                db.update_interview(s.id, student_id=pid, student_name=s.student_name)
                await self._say(s, "Welcome back. Continuing where you left off.")
                await self._send_question(s)
            return

        if s.status != "in_progress" or pid is None or pid != s.student_id:
            return

        if cmd == "/submit":
            if not s.answer_text():
                await self._say(s, "⚠️ No spoken answer detected yet. Speak your answer, then /submit — or use /skip.")
                return
            s.cutoff_rel = rel if rel is not None else s.last_rel
            await self._finish_question(s, "submitted")
        elif cmd == "/skip":
            s.cutoff_rel = rel if rel is not None else s.last_rel
            await self._finish_question(s, "skipped")
        elif cmd == "/clear":
            s.cutoff_rel = rel if rel is not None else s.last_rel
            s.buffer, s.partial = [], ""
            await self.hub.publish(s.id, {"type": "cleared"})
            await self._say(s, f"🧹 Answer cleared. Speak again — ⏱ {fmt_secs(s.remaining())} left.")
        elif cmd == "/show":
            ans = s.answer_text()
            await self._say(s, "📝 So far: " + (preview(ans, 600) if ans else "(nothing recorded yet)"))
        elif cmd == "/repeat":
            await self._send_question(s)
        elif cmd == "/help":
            await self._say(s, "Commands: /submit save answer & next · /skip skip question · "
                               "/clear erase your current answer · /show see your answer so far · "
                               "/repeat show the question again")

    # ---- questions & timer -----------------------------------------
    async def _send_question(self, s: Session) -> None:
        q = s.questions[s.q_index]
        await self._say(
            s,
            f"Q{s.q_index + 1}/{len(s.questions)}: {q.text}\n"
            f"⏱ {fmt_secs(s.remaining())} left   |   /submit  /skip  /clear",
        )

    async def _start_question(self, s: Session, idx: int) -> None:
        q = s.questions[idx]
        s.q_index = idx
        s.buffer, s.partial = [], ""
        s.q_started_at = time.time()
        s.deadline = s.q_started_at + q.time_limit_sec
        s.last_speech_at = time.time()
        s.silence_reminder_sent = False
        db.update_interview(s.id, current_index=idx)
        await self.hub.publish(s.id, {
            "type": "question", "q_index": idx, "total": len(s.questions),
            "text": q.text, "limit": q.time_limit_sec, "deadline": s.deadline,
        })
        await self._send_question(s)
        s.timer_task = asyncio.create_task(self._timer(s, idx))

    def _cancel_timer(self, s: Session) -> None:
        t = s.timer_task
        if t and not t.done() and t is not asyncio.current_task():
            t.cancel()
        s.timer_task = None

    async def _timer(self, s: Session, idx: int) -> None:
        limit = s.questions[idx].time_limit_sec
        warn = min(self.cfg.warn_before_sec, max(1, limit // 3))
        warned_time = False
        silence_timeout = self.cfg.silence_timeout_sec
        try:
            while True:
                await asyncio.sleep(1)
                async with s.lock:
                    if s.status != "in_progress" or s.q_index != idx:
                        return
                    rem = s.remaining()
                    if rem <= 0:
                        s.cutoff_rel = s.last_rel
                        await self._finish_question(s, "auto_submitted")
                        return

                    # Silence / Inactivity check
                    if (not s.silence_reminder_sent and silence_timeout > 0 
                            and silence_timeout < (limit - warn)):
                        silence_dur = time.time() - s.last_speech_at
                        if silence_dur >= silence_timeout and rem > warn:
                            s.silence_reminder_sent = True
                            await self._say(s, f"💡 Still thinking? You have {fmt_secs(rem)} left. Speak your answer, or type /skip to move to the next question.")
                            await self.hub.publish(s.id, {
                                "type": "silence_detected", "q_index": idx,
                                "silence_sec": int(silence_dur), "remaining_sec": rem
                            })

                    # Time-remaining warning check
                    if not warned_time and rem <= warn:
                        warned_time = True
                        await self._say(s, f"⏱ {warn} seconds left for this question. /submit to save your answer.")
        except asyncio.CancelledError:
            return

    async def _finish_question(self, s: Session, status: str) -> None:
        """Caller holds s.lock."""
        idx = s.q_index
        q = s.questions[idx]
        answer = "" if status == "skipped" else s.answer_text()
        ended = time.time()
        db.save_answer(s.id, idx, q.text, answer, status, s.q_started_at, ended)
        self._cancel_timer(s)
        s.buffer, s.partial = [], ""
        await self.hub.publish(s.id, {
            "type": "answer_saved", "q_index": idx, "status": status,
            "answer": answer, "words": len(answer.split()),
            "duration_sec": round(ended - s.q_started_at, 1),
        })
        n = idx + 1
        if status == "submitted":
            await self._say(s, f"✅ Saved Q{n}: {preview(answer)}")
        elif status == "skipped":
            await self._say(s, f"⏭ Skipped Q{n}.")
        else:
            await self._say(s, f"⏱ Time's up. " + (f"Auto-saved Q{n}: {preview(answer)}" if answer
                                                   else f"No answer was recorded for Q{n}."))
        if n < len(s.questions):
            await self._start_question(s, n)
        else:
            await self._complete(s)

    async def _complete(self, s: Session) -> None:
        s.status = "completed"
        s.deadline = 0.0
        db.update_interview(s.id, status="completed", finished_at=time.time())
        await self.hub.publish(s.id, {"type": "completed"})
        await self._say(s, "🎉 Interview complete. Thank you! You may leave the meeting now.")
        asyncio.create_task(self._notify_main_backend(s))
        asyncio.create_task(self._leave_later(s))

    async def _notify_main_backend(self, s: Session) -> None:
        """Forward completed interview answers to main platform evaluation pipeline."""
        target_url = "http://127.0.0.1:8001/meetings/zoom-bot/complete"
        payload = {
            "interview_id": s.id,
            "candidate_name": s.candidate_name,
            "status": "completed",
            "answers": db.get_answers(s.id)
        }
        try:
            import httpx
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(target_url, json=payload)
                log.info("Notified main backend for interview %s: %s", s.id, resp.status_code)
        except Exception as e:
            log.warning("Could not notify main backend: %s (backend may not be running or endpoint offline)", e)

    async def _sync_event_to_main_backend(self, s: Session, ev: dict[str, Any]) -> None:
        """Fire-and-forget sync of real-time bot event to main platform."""
        try:
            import httpx
            payload = {
                "interview_id": s.id,
                "candidate_name": s.candidate_name,
                "event": ev
            }
            async with httpx.AsyncClient(timeout=2) as client:
                await client.post("http://127.0.0.1:8001/meetings/zoom-bot/event", json=payload)
        except Exception:
            pass
