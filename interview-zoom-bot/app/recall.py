"""Recall.ai client (real) + a mock that only logs.

Endpoints used (from docs.recall.ai):
  POST /api/v1/bot/                       create bot
  POST /api/v1/bot/{id}/send_chat_message/  body {"message": "...", "to": "everyone" | "<participant id>"}
  POST /api/v1/bot/{id}/leave_call/       (verify the exact path in your Recall version)
"""
from __future__ import annotations

import logging
import uuid
from typing import Any
from urllib.parse import urlencode

import httpx

from .config import Settings

log = logging.getLogger("recall")

REALTIME_EVENTS = [
    "participant_events.join",
    "participant_events.leave",
    "participant_events.chat_message",
    "transcript.data",
    "transcript.partial_data",
]


class RecallError(Exception):
    pass


def build_bot_payload(s: Settings, meeting_url: str, interview_id: str) -> dict[str, Any]:
    """Body for POST /bot/. Kept separate so it can be unit-tested / printed."""
    if not s.public_base_url:
        raise RecallError(
            "PUBLIC_BASE_URL is empty. Start a tunnel (ngrok http 8000) and put the https URL in .env"
        )
    hook = f"{s.public_base_url}/webhook/recall?" + urlencode(
        {"token": s.webhook_token, "interview_id": interview_id}
    )

    deepgram: dict[str, Any] = {"model": s.deepgram_model, "language": s.deepgram_language}
    if s.deepgram_interim:
        deepgram["interim_results"] = True

    transcript: dict[str, Any] = {"provider": {"deepgram_streaming": deepgram}}
    if s.perfect_diarization:
        # Separate audio stream per participant. Verify key name at docs.recall.ai/docs/diarization
        transcript["diarization"] = {"use_separate_streams_when_available": True}

    payload: dict[str, Any] = {
        "meeting_url": meeting_url,
        "bot_name": s.bot_name,
        "recording_config": {
            "transcript": transcript,
            "realtime_endpoints": [
                {"type": "webhook", "url": hook, "events": REALTIME_EVENTS}
            ],
        },
    }

    zoom: dict[str, Any] = {}
    if s.zoom_obf_token_url:
        zoom["obf_token_url"] = s.zoom_obf_token_url
    if s.zoom_zak_url:
        zoom["zak_url"] = s.zoom_zak_url
    if zoom:
        payload["zoom"] = zoom
    return payload


class RecallClient:
    def __init__(self, s: Settings) -> None:
        self.s = s
        self.base = f"https://{s.recall_region}.recall.ai/api/v1"

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Token {self.s.recall_api_key}",
            "accept": "application/json",
            "content-type": "application/json",
        }

    async def _req(self, method: str, path: str, body: dict | None = None) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=30) as c:
            r = await c.request(method, self.base + path, headers=self._headers(), json=body)
        if r.status_code >= 300:
            raise RecallError(f"{method} {path} -> {r.status_code}: {r.text[:600]}")
        return r.json() if r.text else {}

    async def create_bot(self, meeting_url: str, interview_id: str) -> dict[str, Any]:
        payload = build_bot_payload(self.s, meeting_url, interview_id)
        return await self._req("POST", "/bot/", payload)

    async def send_chat(self, bot_id: str, message: str, to: str = "everyone") -> None:
        await self._req("POST", f"/bot/{bot_id}/send_chat_message/", {"message": message, "to": to})

    async def leave(self, bot_id: str) -> None:
        await self._req("POST", f"/bot/{bot_id}/leave_call/", {})


class MockRecall:
    """No network. Used when RECALL_API_KEY is empty or MOCK_MODE=true."""

    async def create_bot(self, meeting_url: str, interview_id: str) -> dict[str, Any]:
        return {"id": f"mock-bot-{uuid.uuid4().hex[:8]}"}

    async def send_chat(self, bot_id: str, message: str, to: str = "everyone") -> None:
        log.info("[mock chat -> %s] %s", to, message.replace("\n", " | "))

    async def leave(self, bot_id: str) -> None:
        log.info("[mock] bot %s leaves the call", bot_id)
