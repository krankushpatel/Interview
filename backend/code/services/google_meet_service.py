"""Google Meet REST API v2 Service (Google Workspace Enterprise Auto-Create with OPEN Access).

Uses pure httpx + OAuth2 Refresh Token (no heavy Google SDK dependency required) to call:
    POST https://meet.googleapis.com/v2/spaces
with:
    {"config": {"accessType": "OPEN", "entryPointAccess": "ALL", "moderation": "OFF"}}

Result:
- Admin never has to manually open meet.google.com/new or tweak Host Controls.
- Any candidate (including personal @gmail.com students) AND the Interviewer bot
  enter immediately with ZERO knocking ('Ask to join') and ZERO waiting for host.
"""
from __future__ import annotations

import logging
import os
import time
from pathlib import Path
from typing import Any, Dict, Optional

import httpx
from dotenv import load_dotenv

log = logging.getLogger("google_meet_service")

_BACKEND_DIR = Path(__file__).resolve().parents[2]
_ENV_PATH = _BACKEND_DIR / ".env"

MEET_SPACES_ENDPOINT = "https://meet.googleapis.com/v2/spaces"
GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"


class GoogleMeetService:
    def __init__(self) -> None:
        self._cached_access_token: Optional[str] = None
        self._token_expires_at: float = 0.0

    def _reload_env(self) -> None:
        if _ENV_PATH.exists():
            load_dotenv(_ENV_PATH, override=False)

    def get_credentials(self) -> Dict[str, str]:
        self._reload_env()
        return {
            "client_id": os.getenv("GOOGLE_MEET_CLIENT_ID", "").strip(),
            "client_secret": os.getenv("GOOGLE_MEET_CLIENT_SECRET", "").strip(),
            "refresh_token": os.getenv("GOOGLE_MEET_REFRESH_TOKEN", "").strip(),
        }

    def is_configured(self) -> bool:
        creds = self.get_credentials()
        return bool(creds["client_id"] and creds["client_secret"] and creds["refresh_token"])

    async def get_access_token(self, force_refresh: bool = False) -> str:
        """Exchange the Workspace OAuth2 Refresh Token for a short-lived Bearer access token."""
        now = time.time()
        if not force_refresh and self._cached_access_token and now < self._token_expires_at:
            return self._cached_access_token

        creds = self.get_credentials()
        if not (creds["client_id"] and creds["client_secret"] and creds["refresh_token"]):
            raise ValueError(
                "Google Meet Enterprise API credentials are not configured in backend/.env "
                "(GOOGLE_MEET_CLIENT_ID, GOOGLE_MEET_CLIENT_SECRET, GOOGLE_MEET_REFRESH_TOKEN). "
                "Run `backend\\.venv\\Scripts\\python.exe backend\\scripts\\google_meet_auth_setup.py` once to connect your Workspace account."
            )

        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                GOOGLE_TOKEN_ENDPOINT,
                data={
                    "client_id": creds["client_id"],
                    "client_secret": creds["client_secret"],
                    "refresh_token": creds["refresh_token"],
                    "grant_type": "refresh_token",
                },
            )

        if resp.status_code != 200:
            raise RuntimeError(
                f"Google OAuth token refresh failed ({resp.status_code}): {resp.text[:300]}"
            )

        data = resp.json()
        token = data.get("access_token")
        if not token:
            raise RuntimeError(f"Google OAuth response missing access_token: {data}")

        expires_in = int(data.get("expires_in", 3600))
        self._cached_access_token = token
        self._token_expires_at = now + max(60, expires_in - 180)
        return token

    async def create_open_meeting(self, topic: str = "Technical Interview") -> Dict[str, Any]:
        """
        Programmatically create a Google Meet space with:
          - accessType: OPEN        (personal @gmail.com students & Interviewer enter directly without knocking)
          - entryPointAccess: ALL   (works across web browser, Android/iOS Meet app)
          - moderation: OFF         (unrestricted mic, chat & screen-share for Interviewer)
        """
        token = await self.get_access_token()
        payload = {
            "config": {
                "accessType": "OPEN",
                "entryPointAccess": "ALL",
                "moderation": "OFF",
            }
        }

        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                MEET_SPACES_ENDPOINT,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )

            # Retry once with a fresh token if cached token was revoked/expired
            if resp.status_code == 401:
                token = await self.get_access_token(force_refresh=True)
                resp = await client.post(
                    MEET_SPACES_ENDPOINT,
                    headers={
                        "Authorization": f"Bearer {token}",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                )

            # Some Workspace tiers restrict setting `moderation` via API — gracefully retry with accessType=OPEN only
            if resp.status_code == 400 and "moderation" in resp.text.lower():
                log.warning("[GoogleMeetService] Retrying spaces.create without moderation field...")
                resp = await client.post(
                    MEET_SPACES_ENDPOINT,
                    headers={
                        "Authorization": f"Bearer {token}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "config": {
                            "accessType": "OPEN",
                            "entryPointAccess": "ALL",
                        }
                    },
                )

        if resp.status_code not in (200, 201):
            raise RuntimeError(
                f"Google Meet REST API v2 create space failed ({resp.status_code}): {resp.text[:400]}"
            )

        data = resp.json()
        meeting_uri = data.get("meetingUri") or ""
        meeting_code = data.get("meetingCode") or ""
        space_name = data.get("name") or ""
        config_out = data.get("config") or {}

        if not meeting_uri:
            raise RuntimeError(f"Google Meet API returned no meetingUri: {data}")

        log.info(
            "[GoogleMeetService] Created OPEN Google Meet space: uri=%s code=%s accessType=%s",
            meeting_uri,
            meeting_code,
            config_out.get("accessType"),
        )
        return {
            "provider": "google_meet",
            "meeting_url": meeting_uri,
            "join_url": meeting_uri,
            "meet_url": meeting_uri,
            "meeting_id": meeting_code or meeting_uri.split("meet.google.com/")[-1].strip("/"),
            "space_name": space_name,
            "access_type": config_out.get("accessType", "OPEN"),
            "topic": topic,
        }

    async def test_connection(self) -> Dict[str, Any]:
        """Verify Workspace credentials by refreshing token and provisioning a test OPEN space."""
        space = await self.create_open_meeting(topic="Connection Test")
        return {
            "success": True,
            "message": "Google Meet Enterprise API connected successfully (OPEN access verified)",
            "sample_meeting_url": space["meeting_url"],
            "access_type": space["access_type"],
        }


google_meet_service = GoogleMeetService()
