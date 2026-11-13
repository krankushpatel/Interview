"""FastAPI router for Zoom Bot, mounted inside main backend."""
from __future__ import annotations

import json
import logging
from collections import deque
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, RedirectResponse
from pydantic import BaseModel, Field

from . import db
from .config import load_settings
from .engine import Engine
from .hub import Hub
from .recall import MockRecall, RecallClient, RecallError

log = logging.getLogger("zoom_bot")

settings = load_settings()
hub = Hub()
recall = MockRecall() if settings.mock_mode else RecallClient(settings)
engine = Engine(settings, recall, hub)

# Initialize SQLite database
db.init(settings.db_path)

# Direct in-memory event listener to sync Admin Live Tracking
async def _in_memory_event_listener(interview_id: str, payload: dict[str, Any]) -> None:
    try:
        from code.services.zoom_bot_service import zoom_bot_service
        s = engine.sessions.get(interview_id)
        candidate_name = s.candidate_name if s else ""
        await zoom_bot_service.handle_bot_event({
            "interview_id": interview_id,
            "candidate_name": candidate_name,
            "event": payload
        })
    except Exception:
        pass

hub.listener = _in_memory_event_listener

STATIC = Path(__file__).resolve().parent.parent.parent / "interview-zoom-bot" / "app" / "static"
raw_events: deque[dict[str, Any]] = deque(maxlen=300)

router = APIRouter()


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
@router.get("/health")
@router.get("/api/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "mode": "mock" if settings.mock_mode else "live",
        "default_time_limit_sec": settings.default_time_limit_sec,
        "chat_mode": settings.chat_mode,
        "silence_timeout_sec": settings.silence_timeout_sec,
        "auth_required": bool(settings.admin_key)
    }


@router.post("/api/interviews", dependencies=[Depends(require_admin)])
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


@router.get("/api/interviews", dependencies=[Depends(require_admin)])
def list_interviews() -> list[dict[str, Any]]:
    out = []
    for row in db.list_interviews():
        s = engine.sessions.get(row["id"])
        out.append({
            "id": row["id"],
            "candidate_name": row["candidate_name"],
            "status": s.status if s else row["status"],
            "q_index": s.q_index if s else row["current_index"],
            "total_questions": len(row["questions"]),
            "created_at": row["created_at"],
        })
    return out


@router.get("/api/interviews/{iid}", dependencies=[Depends(require_admin)])
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


@router.post("/api/interviews/{iid}/end", dependencies=[Depends(require_admin)])
async def end_interview(iid: str) -> dict[str, Any]:
    s = engine.sessions.get(iid)
    if not s:
        raise HTTPException(404, "interview is not live")
    await engine.abort(s)
    return s.snapshot()


@router.get("/api/debug/events", dependencies=[Depends(require_admin)])
def debug_events(limit: int = 50) -> list[dict[str, Any]]:
    return list(raw_events)[-limit:]


# --------------------------------------------------------------- webhook
@router.post("/webhook/recall")
async def recall_webhook(request: Request, token: str = "", interview_id: str = "") -> dict[str, Any]:
    if token != settings.webhook_token:
        raise HTTPException(401, "bad token")
    try:
        ev = await request.json()
    except Exception:
        raise HTTPException(400, "invalid json")
    raw_events.append(ev)

    iid = interview_id or (ev.get("data") or {}).get("bot", {}).get("metadata", {}).get("interview_id")
    s = engine.sessions.get(iid)
    if not s:
        log.warning("event for unknown session %s: %s", iid, ev.get("event"))
        return {"ignored": True, "reason": "unknown session"}
    await engine.handle_event(s, ev)
    return {"ok": True}


@router.get("/webhook/health")
async def webhook_health() -> dict[str, Any]:
    """Health check endpoint - used to verify tunnel is working."""
    return {"status": "ok", "service": "interview-bot", "webhook_path": "/zoom-bot/webhook/meeting-baas"}


@router.post("/webhook/meeting-baas")
async def meeting_baas_webhook(request: Request) -> dict[str, Any]:
    try:
        ev = await request.json()
    except Exception:
        raise HTTPException(400, "invalid json")
    
    event_type = ev.get("event", "")
    data = ev.get("data", {})
    bot_id = ev.get("bot_id", "")
    log.info("[MeetingBaaS] Webhook event received: type=%s bot=%s payload_keys=%s",
             event_type, bot_id, list(ev.keys()))

    # Merge top-level bot_id into data so handler can always find it
    if bot_id and "bot_id" not in data:
        data["bot_id"] = bot_id

    try:
        from code.services.zoom_bot_service import zoom_bot_service
        await zoom_bot_service.handle_meeting_baas_event(event_type, data)
    except Exception as e:
        log.warning("[MeetingBaaS] Webhook handler notice: %s", e, exc_info=True)

    return {"ok": True}


# ------------------------------------------------------------- WebSocket
@router.websocket("/ws/admin")
async def ws_admin(ws: WebSocket, interview_id: str = Query(default=""), key: str = Query(default="")) -> None:
    if settings.admin_key and key != settings.admin_key:
        await ws.close(code=4401, reason="bad admin key")
        return
    await hub.connect(ws, interview_id or None)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        hub.disconnect(ws)
