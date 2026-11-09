"""FastAPI app: REST for your platform, webhook for Recall, WebSocket for live admin view."""
from __future__ import annotations

import json
import logging
from collections import deque
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, RedirectResponse
from pydantic import BaseModel, Field

from . import db
from .config import load_settings
from .engine import Engine
from .hub import Hub
from .recall import MockRecall, RecallClient, RecallError

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("app")

settings = load_settings()
hub = Hub()
recall = MockRecall() if settings.mock_mode else RecallClient(settings)
engine = Engine(settings, recall, hub)

async def _sync_to_main_platform(interview_id: str, payload: dict[str, Any]) -> None:
    try:
        import httpx
        s = engine.sessions.get(interview_id)
        candidate_name = s.candidate_name if s else ""
        body = {
            "interview_id": interview_id,
            "candidate_name": candidate_name,
            "event": payload
        }
        async with httpx.AsyncClient(timeout=2) as client:
            await client.post("http://127.0.0.1:8001/meetings/zoom-bot/event", json=body)
    except Exception:
        pass

hub.listener = _sync_to_main_platform

STATIC = Path(__file__).parent / "static"
RAW_LOG = Path(settings.db_path).parent / "events.jsonl"
raw_events: deque[dict[str, Any]] = deque(maxlen=300)


@asynccontextmanager
async def lifespan(_: FastAPI):
    db.init(settings.db_path)
    log.info("mode=%s  public_base_url=%s", "MOCK" if settings.mock_mode else "LIVE (Recall)",
             settings.public_base_url or "(not set)")
    yield


app = FastAPI(title="Zoom Interview Bot (prototype)", lifespan=lifespan)


# ------------------------------------------------------------------ auth
def require_admin(key: str = Query(default=""), x_admin_key: str = Header(default="")) -> None:
    if settings.admin_key and settings.admin_key not in (key, x_admin_key):
        raise HTTPException(status_code=401, detail="bad admin key")


# ---------------------------------------------------------------- schemas
class QuestionIn(BaseModel):
    text: str
    time_limit_sec: int | None = None


class InterviewIn(BaseModel):
    candidate_name: str = "Candidate"
    meeting_url: str = Field(default="", description="Zoom join URL (any text is fine in mock mode)")
    questions: list[str | QuestionIn]
    time_limit_sec: int | None = Field(default=None, description="Default per-question limit; falls back to DEFAULT_TIME_LIMIT_SEC")


# ------------------------------------------------------------------- REST
@app.get("/")
def root() -> RedirectResponse:
    return RedirectResponse("/admin")


@app.get("/admin")
def admin_page() -> FileResponse:
    return FileResponse(STATIC / "admin.html")


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"ok": True, "mode": "mock" if settings.mock_mode else "live",
            "default_time_limit_sec": settings.default_time_limit_sec,
            "chat_mode": settings.chat_mode, "auth_required": bool(settings.admin_key)}


@app.post("/api/interviews", dependencies=[Depends(require_admin)])
async def create_interview(body: InterviewIn) -> dict[str, Any]:
    if not settings.mock_mode and not body.meeting_url.strip():
        raise HTTPException(400, "meeting_url is required")
    qs: list[tuple[str, int | None]] = []
    for q in body.questions:
        qs.append((q, None) if isinstance(q, str) else (q.text, q.time_limit_sec))
    try:
        s = await engine.create(body.candidate_name, body.meeting_url.strip(), qs, body.time_limit_sec)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except RecallError as e:
        raise HTTPException(502, f"Recall error: {e}")
    return s.snapshot()


@app.get("/api/interviews", dependencies=[Depends(require_admin)])
def list_interviews() -> list[dict[str, Any]]:
    out = []
    for row in db.list_interviews():
        s = engine.sessions.get(row["id"])
        out.append({
            "id": row["id"], "candidate_name": row["candidate_name"],
            "status": s.status if s else row["status"],
            "q_index": s.q_index if s else row["current_index"],
            "total_questions": len(row["questions"]), "created_at": row["created_at"],
        })
    return out


@app.get("/api/interviews/{iid}", dependencies=[Depends(require_admin)])
def get_interview(iid: str) -> dict[str, Any]:
    s = engine.sessions.get(iid)
    if s:
        return s.snapshot()
    row = db.get_interview(iid)
    if not row:
        raise HTTPException(404, "unknown interview")
    row["live"] = False
    row["answers"] = db.get_answers(iid)
    row["total_questions"] = len(row["questions"])
    return row


@app.post("/api/interviews/{iid}/end", dependencies=[Depends(require_admin)])
async def end_interview(iid: str) -> dict[str, Any]:
    s = engine.sessions.get(iid)
    if not s:
        raise HTTPException(404, "interview is not live")
    await engine.abort(s)
    return s.snapshot()


@app.get("/api/debug/events", dependencies=[Depends(require_admin)])
def debug_events(limit: int = 50) -> list[dict[str, Any]]:
    """Last raw webhook events — paste these when something does not match."""
    return list(raw_events)[-limit:]


# --------------------------------------------------------------- webhook
@app.post("/webhook/recall")
async def recall_webhook(request: Request, token: str = "", interview_id: str = "") -> dict[str, Any]:
    if token != settings.webhook_token:
        raise HTTPException(401, "bad token")
    try:
        ev = await request.json()
    except Exception:
        raise HTTPException(400, "invalid json")
    raw_events.append(ev)
    try:
        RAW_LOG.parent.mkdir(parents=True, exist_ok=True)
        with RAW_LOG.open("a", encoding="utf-8") as f:
            f.write(json.dumps({"interview_id": interview_id, "event": ev}, ensure_ascii=False) + "\n")
    except OSError:
        pass
    s = engine.sessions.get(interview_id)
    if not s:
        return {"ok": False, "reason": "unknown interview"}
    await engine.handle_event(s, ev)
    return {"ok": True}


# -------------------------------------------------------------- websocket
@app.websocket("/ws/admin")
async def ws_admin(ws: WebSocket, interview_id: str = "", key: str = "") -> None:
    if settings.admin_key and key != settings.admin_key:
        await ws.close(code=4401)
        return
    await hub.connect(ws, interview_id or None)
    try:
        while True:
            await ws.receive_text()  # keep-alive; client pings are ignored
    except WebSocketDisconnect:
        pass
    finally:
        hub.disconnect(ws)
