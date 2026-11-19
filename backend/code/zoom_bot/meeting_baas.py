"""Meeting BaaS Client for deploying and managing Zoom meeting bots."""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, Optional
import httpx

log = logging.getLogger("zoom_bot.meeting_baas")

MEETING_BAAS_API_BASE = "https://api.meetingbaas.com/v2"


class MeetingBaaSClient:
    def __init__(self, api_key: str = "") -> None:
        self.api_key = api_key or os.getenv("MEETING_BAAS_API_KEY", "").strip()
        if not self.api_key:
            from pathlib import Path
            from dotenv import load_dotenv
            env_file = Path(__file__).resolve().parents[2] / ".env"
            if env_file.exists():
                load_dotenv(env_file, override=False)
            self.api_key = os.getenv("MEETING_BAAS_API_KEY", "").strip()
        self.base_url = MEETING_BAAS_API_BASE

    def _headers(self) -> Dict[str, str]:
        return {
            "x-meeting-baas-api-key": self.api_key,
            "Content-Type": "application/json",
            "Accept": "application/json"
        }

    async def create_bot(
        self,
        meeting_url: str,
        bot_name: str = "Interviewer",
        entry_message: str = "",
        webhook_url: str = "",
        extra: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Deploy bot to live Zoom meeting.
        """
        if not self.api_key:
            raise ValueError("MEETING_BAAS_API_KEY is not configured")

        payload: Dict[str, Any] = {
            "meeting_url": meeting_url,
            "bot_name": bot_name,
        }
        if entry_message:
            payload["entry_message"] = entry_message
        if webhook_url:
            payload["webhook_url"] = webhook_url
            payload["callback_url"] = webhook_url
            payload["callback_config"] = {"url": webhook_url}
        if extra:
            payload["extra"] = extra

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{self.base_url}/bots",
                json=payload,
                headers=self._headers()
            )
            if resp.status_code >= 400:
                log.error("[MeetingBaaS] Failed to deploy bot: %s - %s", resp.status_code, resp.text)
                raise RuntimeError(f"Meeting BaaS error ({resp.status_code}): {resp.text}")
            
            data = resp.json()
            log.info("[MeetingBaaS] Bot deployed successfully: %s", data)
            # Normalize v2 response structure so data['bot_id'] is always accessible
            if isinstance(data, dict):
                inner_id = (data.get("data") or {}).get("bot_id")
                if inner_id and "bot_id" not in data:
                    data["bot_id"] = inner_id
            return data

    async def get_bot(self, bot_id: str) -> Dict[str, Any]:
        """Get live bot status."""
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"{self.base_url}/bots/{bot_id}",
                headers=self._headers()
            )
            return resp.json() if resp.status_code < 400 else {}

    async def send_chat_message(self, bot_id: str, message: str) -> bool:
        """Send live in-meeting chat message through the bot."""
        if not self.api_key or not bot_id or not message.strip():
            return False
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.post(
                    f"{self.base_url}/bots/{bot_id}/send-chat-message",
                    json={"message": message.strip()},
                    headers=self._headers()
                )
                if resp.status_code == 200:
                    log.info("[MeetingBaaS] Chat message sent successfully to bot %s", bot_id)
                    return True
                else:
                    log.warning("[MeetingBaaS] Failed to send chat message (%s): %s", resp.status_code, resp.text)
                    return False
        except Exception as e:
            log.warning("[MeetingBaaS] Error sending chat message: %s", e)
            return False

    async def leave_bot(self, bot_id: str) -> bool:
        """Disconnect bot from meeting."""
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.post(
                    f"{self.base_url}/bots/{bot_id}/leave",
                    headers=self._headers()
                )
                return resp.status_code in (200, 204)
        except Exception as e:
            log.warning("[MeetingBaaS] Error leaving call for bot %s: %s", bot_id, e)
            return False

    async def get_meeting_data(self, bot_id: str) -> Dict[str, Any]:
        """Retrieve full transcript, speaker diarization, and chat logs."""
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(
                f"{self.base_url}/bots/meeting_data",
                params={"bot_id": bot_id},
                headers=self._headers()
            )
            return resp.json() if resp.status_code < 400 else {}

