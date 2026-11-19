"""One-Time Setup Helper for Google Meet Enterprise REST API v2 (OAuth2 Refresh Token).

Usage:
    backend\\.venv\\Scripts\\python.exe backend\\scripts\\google_meet_auth_setup.py

Prerequisites (Google Cloud Console):
    1. Enable `Google Meet REST API` in your Google Cloud project.
    2. Create an OAuth 2.0 Client ID (Application type: Desktop app OR Web app).
       - If Web app, add Authorized redirect URI: http://localhost:8765/callback
    3. Run this script and sign in ONCE with your Google Workspace Enterprise account.
    4. This script verifies OPEN space creation and saves credentials into backend/.env!
"""
from __future__ import annotations

import http.server
import os
import re
import threading
import urllib.parse
import webbrowser
from pathlib import Path

import httpx
from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parents[1]
ENV_PATH = BACKEND_DIR / ".env"

REDIRECT_PORT = 8765
REDIRECT_URI = f"http://localhost:{REDIRECT_PORT}/callback"
SCOPES = "https://www.googleapis.com/auth/meetings.space.created"


def _upsert_env_var(env_path: Path, key: str, value: str) -> None:
    content = env_path.read_text(encoding="utf-8") if env_path.exists() else ""
    line = f'{key}="{value}"'
    pattern = re.compile(rf"^{re.escape(key)}=.*$", re.MULTILINE)
    if pattern.search(content):
        content = pattern.sub(line, content)
    else:
        if content and not content.endswith("\n"):
            content += "\n"
        content += line + "\n"
    env_path.write_text(content, encoding="utf-8")


def main() -> None:
    if ENV_PATH.exists():
        load_dotenv(ENV_PATH, override=False)

    print("=" * 72)
    print("🌐 Google Meet Enterprise REST API v2 — One-Time Workspace Setup")
    print("=" * 72)

    client_id = os.getenv("GOOGLE_MEET_CLIENT_ID", "").strip()
    client_secret = os.getenv("GOOGLE_MEET_CLIENT_SECRET", "").strip()

    if not client_id:
        client_id = input("Enter GOOGLE_MEET_CLIENT_ID: ").strip()
    else:
        print(f"✅ Using GOOGLE_MEET_CLIENT_ID from .env ({client_id[:16]}...)")

    if not client_secret:
        client_secret = input("Enter GOOGLE_MEET_CLIENT_SECRET: ").strip()
    else:
        print("✅ Using GOOGLE_MEET_CLIENT_SECRET from .env")

    if not client_id or not client_secret:
        print("❌ Client ID and Client Secret are required. Aborting.")
        return

    auth_code_box: dict[str, str] = {}
    done_event = threading.Event()

    class CallbackHandler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            parsed = urllib.parse.urlparse(self.path)
            qs = urllib.parse.parse_qs(parsed.query)
            if "code" in qs:
                auth_code_box["code"] = qs["code"][0]
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.end_headers()
                self.wfile.write(
                    b"<h2>&#9989; Google Workspace Connected!</h2>"
                    b"<p>You can close this tab and return to your terminal.</p>"
                )
                done_event.set()
            elif "error" in qs:
                auth_code_box["error"] = qs["error"][0]
                self.send_response(400)
                self.end_headers()
                self.wfile.write(f"OAuth Error: {qs['error'][0]}".encode("utf-8"))
                done_event.set()
            else:
                self.send_response(404)
                self.end_headers()

        def log_message(self, format, *args):
            pass

    server = http.server.HTTPServer(("127.0.0.1", REDIRECT_PORT), CallbackHandler)
    srv_thread = threading.Thread(target=server.serve_forever, daemon=True)
    srv_thread.start()

    auth_params = urllib.parse.urlencode({
        "client_id": client_id,
        "redirect_uri": REDIRECT_URI,
        "response_type": "code",
        "scope": SCOPES,
        "access_type": "offline",
        "prompt": "consent",
    })
    auth_url = f"https://accounts.google.com/o/oauth2/v2/auth?{auth_params}"

    print("\n👉 Opening browser for Google Workspace Admin sign-in...")
    print(f"   If browser doesn't open, paste this URL:\n   {auth_url}\n")
    webbrowser.open(auth_url)

    print("⏳ Waiting for Google authorization callback on http://localhost:8765/callback ...")
    done_event.wait(timeout=300)
    server.shutdown()

    if "error" in auth_code_box or "code" not in auth_code_box:
        print(f"❌ Authorization failed: {auth_code_box.get('error', 'Timed out')}")
        return

    print("🔄 Exchanging authorization code for refresh_token...")
    resp = httpx.post(
        "https://oauth2.googleapis.com/token",
        data={
            "code": auth_code_box["code"],
            "client_id": client_id,
            "client_secret": client_secret,
            "redirect_uri": REDIRECT_URI,
            "grant_type": "authorization_code",
        },
        timeout=20.0,
    )
    if resp.status_code != 200:
        print(f"❌ Token exchange failed ({resp.status_code}): {resp.text}")
        return

    tok_data = resp.json()
    refresh_token = tok_data.get("refresh_token")
    access_token = tok_data.get("access_token")
    if not refresh_token:
        print("❌ Google did not return a refresh_token. Try revoking app access in your Google account and re-running.")
        return

    # Save to backend/.env
    _upsert_env_var(ENV_PATH, "GOOGLE_MEET_CLIENT_ID", client_id)
    _upsert_env_var(ENV_PATH, "GOOGLE_MEET_CLIENT_SECRET", client_secret)
    _upsert_env_var(ENV_PATH, "GOOGLE_MEET_REFRESH_TOKEN", refresh_token)
    print(f"✅ Saved Google Meet Enterprise credentials into {ENV_PATH}!")

    # Live-test creating an OPEN Meet space right now!
    print("\n🧪 Testing live OPEN Google Meet space creation via Meet REST API v2...")
    space_resp = httpx.post(
        "https://meet.googleapis.com/v2/spaces",
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        },
        json={
            "config": {
                "accessType": "OPEN",
                "entryPointAccess": "ALL",
                "moderation": "OFF",
            }
        },
        timeout=20.0,
    )
    if space_resp.status_code in (200, 201):
        sdata = space_resp.json()
        print("🎉 SUCCESS! Live OPEN Google Meet room created:")
        print(f"   Meet Link  : {sdata.get('meetingUri')}")
        print(f"   AccessType : {(sdata.get('config') or {}).get('accessType')}")
        print("   👉 Restart your FastAPI backend and Admin can now auto-create Google Meet rooms in 1 click!")
    else:
        print(f"⚠️ Credentials saved, but space test returned {space_resp.status_code}: {space_resp.text}")
        print("   Make sure `Google Meet REST API` is enabled in Google Cloud Console and your Workspace Admin allows external/OPEN meetings.")


if __name__ == "__main__":
    main()
