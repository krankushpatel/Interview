
import os
import time
import base64
import httpx
from typing import Optional, Dict, Any
from code.core.data_manager import db
from code.settings_route.routes import load_settings

class ZoomService:
    """
    Handles Zoom Server-to-Server OAuth authentication and automated meeting provisioning.
    Credentials can be dynamically configured via Admin Settings or loaded from .env.
    """
    def __init__(self):
        self._cached_token: Optional[str] = None
        self._token_expires_at: float = 0.0

    def get_credentials(self) -> Dict[str, str]:
        """Fetch credentials from DB exam_settings, falling back to environment variables."""
        settings = load_settings()
        account_id = settings.get("zoom_account_id") or os.getenv("ZOOM_ACCOUNT_ID", "").strip()
        video_sdk_key = settings.get("zoom_video_sdk_key") or os.getenv("ZOOM_VIDEO_SDK_KEY", "").strip()
        video_sdk_secret = settings.get("zoom_video_sdk_secret") or os.getenv("ZOOM_VIDEO_SDK_SECRET", "").strip() or os.getenv("JWT_SECRET_KEY", "").strip()
        client_id = settings.get("zoom_client_id") or os.getenv("ZOOM_CLIENT_ID", "").strip() or video_sdk_key
        client_secret = settings.get("zoom_client_secret") or os.getenv("ZOOM_CLIENT_SECRET", "").strip() or video_sdk_secret
        return {
            "account_id": account_id,
            "client_id": client_id,
            "client_secret": client_secret,
            "video_sdk_key": video_sdk_key,
            "video_sdk_secret": video_sdk_secret
        }

    def generate_video_sdk_token(
        self,
        session_name: str,
        user_identity: str,
        role: int = 0,
        session_key: str = "",
        duration_seconds: int = 86400
    ) -> Dict[str, Any]:
        """
        Generate Zoom Video SDK JWT token.
        role: 1 = Host / Admin, 0 = Participant / Student
        """
        from jose import jwt
        creds = self.get_credentials()
        sdk_key = creds.get("video_sdk_key") or creds.get("client_id") or "zoom_video_sdk_dev"
        sdk_secret = creds.get("video_sdk_secret") or creds.get("client_secret") or os.getenv("JWT_SECRET_KEY", "secret_fallback")

        now = int(time.time())
        iat = now - 30
        exp = now + duration_seconds

        payload = {
            "app_key": sdk_key,
            "version": 1,
            "user_identity": user_identity,
            "iat": iat,
            "exp": exp,
            "tpc": session_name,
            "role_type": role,
            "cloud_recording_option": 0
        }
        if session_key:
            payload["session_key"] = session_key

        token = jwt.encode(payload, sdk_secret, algorithm="HS256")
        return {
            "token": token,
            "session_name": session_name,
            "sdk_key": sdk_key,
            "user_identity": user_identity,
            "role": role,
            "expires_at": exp
        }

    def generate_meeting_sdk_signature(
        self,
        meeting_number: str,
        role: int = 0,
        duration_seconds: int = 7200
    ) -> Dict[str, Any]:
        """Generate signature for Zoom Web Meeting SDK / Component."""
        from jose import jwt
        creds = self.get_credentials()
        client_id = creds.get("client_id") or creds.get("video_sdk_key") or "zoom_client_dev"
        client_secret = creds.get("client_secret") or creds.get("video_sdk_secret") or os.getenv("JWT_SECRET_KEY", "secret_fallback")

        now = int(time.time())
        iat = now - 30
        exp = now + duration_seconds

        payload = {
            "appKey": client_id,
            "sdkKey": client_id,
            "mn": meeting_number,
            "role": role,
            "iat": iat,
            "exp": exp,
            "tokenExp": exp
        }
        token = jwt.encode(payload, client_secret, algorithm="HS256")
        return {
            "signature": token,
            "sdk_key": client_id,
            "meeting_number": meeting_number,
            "role": role
        }

    async def get_access_token(
        self,
        account_id: Optional[str] = None,
        client_id: Optional[str] = None,
        client_secret: Optional[str] = None,
        force_refresh: bool = False
    ) -> str:
        """
        Request Server-to-Server OAuth token from Zoom. Caches token until 5 minutes before expiry.
        """
        creds = self.get_credentials()
        acc_id = account_id or creds["account_id"]
        c_id = client_id or creds["client_id"]
        c_sec = client_secret or creds["client_secret"]

        if not acc_id or not c_id or not c_sec:
            raise ValueError("Zoom credentials missing. Please configure Account ID, Client ID, and Client Secret.")

        # Check if current cached token is still valid
        now = time.time()
        if not force_refresh and self._cached_token and now < self._token_expires_at:
            return self._cached_token

        token_url = f"https://zoom.us/oauth/token?grant_type=account_credentials&account_id={acc_id}"
        auth_header = base64.b64encode(f"{c_id}:{c_sec}".encode("utf-8")).decode("utf-8")

        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                token_url,
                headers={
                    "Authorization": f"Basic {auth_header}",
                    "Content-Type": "application/x-www-form-urlencoded"
                }
            )

        if resp.status_code != 200:
            err_data = resp.text
            try:
                err_json = resp.json()
                err_data = err_json.get("reason", err_json.get("error_description", resp.text))
            except Exception:
                pass
            raise Exception(f"Zoom OAuth authentication failed ({resp.status_code}): {err_data}")

        data = resp.json()
        token = data.get("access_token")
        expires_in = data.get("expires_in", 3600)

        # Cache with 5 minute buffer
        self._cached_token = token
        self._token_expires_at = now + (expires_in - 300)
        return token

    async def test_connection(self, account_id: str, client_id: str, client_secret: str) -> Dict[str, Any]:
        """Verify Zoom credentials by requesting a token and querying the current user profile."""
        token = await self.get_access_token(account_id, client_id, client_secret, force_refresh=True)
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                "https://api.zoom.us/v2/users/me",
                headers={"Authorization": f"Bearer {token}"}
            )

        if resp.status_code == 200:
            user_data = resp.json()
            return {
                "success": True,
                "email": user_data.get("email"),
                "account_id": user_data.get("account_id"),
                "first_name": user_data.get("first_name", ""),
                "last_name": user_data.get("last_name", "")
            }
        else:
            raise Exception(f"Failed to fetch Zoom user profile: {resp.text}")

    async def create_meeting(
        self,
        topic: str = "Candidate Interview",
        candidate_username: str = "",
        duration_minutes: int = 60,
        start_time: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Create an automated Zoom meeting for an examination session.
        Uses type: 2 (Scheduled Meeting) with join_before_host=True and jbh_time=0
        so that candidates can join directly without waiting for the host.
        """
        token = await self.get_access_token()

        # Format start_time for Zoom API (UTC ISO 8601 format: YYYY-MM-DDTHH:MM:SSZ)
        formatted_start = None
        if start_time:
            try:
                dt = datetime.fromisoformat(start_time.replace('Z', '+00:00'))
                formatted_start = dt.strftime('%Y-%m-%dT%H:%M:%SZ')
            except Exception:
                formatted_start = start_time

        payload = {
            "topic": topic,
            "type": 2,  # 2 = Scheduled meeting (REQUIRED for join_before_host to work)
            "duration": duration_minutes,
            "timezone": "Asia/Kolkata",
            "settings": {
                "host_video": True,
                "participant_video": True,
                "join_before_host": True,
                "jbh_time": 0,  # 0 = Participants can join anytime
                "mute_upon_entry": False,
                "waiting_room": False,
                "meeting_authentication": False
            }
        }

        if formatted_start:
            payload["start_time"] = formatted_start

        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                "https://api.zoom.us/v2/users/me/meetings",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json"
                },
                json=payload
            )

        if resp.status_code not in (200, 201):
            raise Exception(f"Failed to create Zoom meeting ({resp.status_code}): {resp.text}")

        meeting = resp.json()
        meeting_record = {
            "meeting_id": str(meeting.get("id")),
            "topic": meeting.get("topic"),
            "host_url": meeting.get("start_url"),
            "join_url": meeting.get("join_url"),
            "app_url": f"zoommtg://zoom.us/join?confno={meeting.get('id')}&pwd={meeting.get('password', '')}&uname={candidate_username}",
            "password": meeting.get("password", ""),
            "candidate_username": candidate_username,
            "provider": "zoom",
            "created_at": time.time(),
            "status": "active"
        }

        # Save to MongoDB for quick candidate dispatching
        try:
            db.active_meetings.update_one(
                {"candidate_username": candidate_username},
                {"$set": meeting_record},
                upsert=True
            )
        except Exception as e:
            print(f"[ZoomService] Warn: Failed to save meeting in Mongo: {e}")

        return meeting_record

    def get_active_meeting_for_candidate(self, username: str) -> Optional[Dict[str, Any]]:
        """Retrieve any currently active meeting provisioned for the candidate."""
        try:
            doc = db.active_meetings.find_one({"candidate_username": username, "status": "active"}, {"_id": 0})
            return doc
        except Exception:
            return None

    def end_meeting_for_candidate(self, username: str) -> bool:
        """Mark meeting as completed/inactive."""
        try:
            db.active_meetings.update_one(
                {"candidate_username": username},
                {"$set": {"status": "ended"}}
            )
            return True
        except Exception:
            return False


zoom_service = ZoomService()

