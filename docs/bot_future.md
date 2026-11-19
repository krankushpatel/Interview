# 🔮 Self-Hosted AI Interviewer Bot — Future Features Roadmap (`bot_future.md`)

> Planned future enhancements for the **100% Free Self-Hosted AI Interviewer Bot** (`backend/code/self_hosted_bot/`).  
> Status: **Planned (Not Implemented Yet)**

---

## 🎙️ Feature 1: Spoken AI Interviewer Voice (Text-to-Speech Question Reading)

### 🎯 Goal
When each question is displayed on the `1280×720` Full-Screen Question Card and posted in the meeting chat, the **Interviewer** should also **speak the question out loud** in a calm, natural human voice inside **Zoom**, **Google Meet**, and **Microsoft Teams** — creating a realistic live interviewer experience.

---

### 🏗️ How It Plugs Into Our Existing Architecture (Zero Extra Drivers)
Our existing [`canvas_renderer.js`](../backend/code/self_hosted_bot/injected/canvas_renderer.js) **already hooks `navigator.mediaDevices.getUserMedia({ audio: true })`** and maintains a live Virtual Microphone (`AudioContext -> MediaStreamAudioDestinationNode`) connected directly into the meeting.

#### Proposed Flow:
1. **Generate Speech on Backend (`tts.py`):**
   - Convert question prompt (e.g. *"Question 1: Explain the difference between mutable and immutable objects in Python."*) into an MP3/WAV buffer (~0.4s latency).
2. **Play into Virtual Mic (`canvas_renderer.js`):**
   - Pass Base64 audio to `window.__AI_INTERVIEWER_DISPLAY__.speakAudio(base64Audio)`.
   - Decode via `audioCtx.decodeAudioData()` and connect to the existing `silentAudioStream` `MediaStreamAudioDestinationNode` (NOT to `audioCtx.destination`, so zero sound plays on host PC speakers!).
3. **Live Visual Sync:**
   - Animate the blue soundwave bars at the bottom of the `1280×720` Question Card in real time while the Interviewer is speaking.

---

### 💰 TTS Engine Options

| Option | Voice Quality | Cost | Notes |
|---|---|---|---|
| **`edge-tts`** (`en-IN-NeerjaNeural` / `en-IN-PrabhatNeural`) | Natural Indian / US English Neural Voice | **₹0 (Free)** | Recommended first choice; fast & natural |
| **Kokoro / Piper TTS** | High-quality Offline Neural Voice | **₹0 (Free)** | 100% local, zero internet dependency |
| **Deepgram Aura / ElevenLabs** | Studio-grade ultra-realistic | Paid | Optional upgrade for enterprise |

---

### 🛡️ Audio Safety & Echo Prevention Rules (Important!)
1. **Zero Local Speaker Noise from TTS:**
   - Bot TTS audio connects ONLY to `MediaStreamAudioDestinationNode` (in-memory WebRTC mic track), never to `audioCtx.destination`.
2. **Zero Physical Mic Interference:**
   - `getUserMedia` is fully overridden by `canvas_renderer.js`; Chromium never accesses the host PC's physical microphone.
3. **Zero Candidate-Side Acoustic Echo in Transcripts:**
   - **Rule:** Speak the question FIRST (3–5 seconds), wait for `speakAudio()` promise to finish, and **start `worker.start_audio_segment(idx)` immediately AFTER speech finishes**.
   - Even if a candidate uses phone/laptop loudspeakers without headphones, the Interviewer's own voice will never leak into `qN.webm` or Deepgram transcripts.
4. **Internal Context Guard (Already Built):**
   - Bot's internal `AudioContext` is already flagged with `__AI_BOT_INTERNAL_CTX__ = true` so `audio_tap.js` Hook #3 ignores it automatically.

---

## 🔇 Feature 2: Silent Server-Side Candidate Playback (Mute Local Speakers While Still Recording)

### 🎯 Goal
Allow running multiple concurrent self-hosted interviews on a single laptop/server **completely silently** (zero candidate audio coming out of host machine speakers), while still capturing 100% of candidate audio into `audio_tap.js`.

### 🛠️ Implementation Note
- In [`audio_tap.js`](../backend/code/self_hosted_bot/injected/audio_tap.js) Hook #3 (`AudioNode.prototype.connect`), route foreign audio nodes to `foreignDest` (`MediaStreamAudioDestinationNode`) and pass the speaker path through a `GainNode` with `gain.value = 0` when `SELF_HOSTED_MUTE_LOCAL_SPEAKER=true`.
- Works across Zoom Web WASM, Google Meet, and MS Teams so 5+ concurrent interviews can run silently on one machine.

---

## 📂 Files to Touch When Ready to Implement
1. `backend/code/self_hosted_bot/tts.py` *(new — `edge-tts` / pluggable TTS helper)*
2. `backend/code/self_hosted_bot/injected/canvas_renderer.js` *(add `speakAudio(b64)` + live wave sync)*
3. `backend/code/self_hosted_bot/injected/audio_tap.js` *(optional local speaker mute toggle)*
4. `backend/code/self_hosted_bot/orchestrator.py` *(speak question before calling `start_audio_segment`)*
5. `backend/code/self_hosted_bot/config.py` *(add `enable_tts`, `tts_voice`, `mute_local_speaker` flags)*

---

## 🌐 Feature 3: Google Meet Enterprise Auto-Entry Setup (`accessType: OPEN`)

> **Code Status:** ✅ **Already Built & Verified!** Only the 1-time Google Cloud / Workspace OAuth credentials setup remains.  
> **Use Case:** Admin uses Google Workspace (Enterprise) account to auto-create `OPEN` Google Meet rooms (`accessType: OPEN`, `moderation: OFF`). Students using personal `@gmail.com` AND the `Interviewer` bot enter directly with **zero knocking ("Ask to join")** and **zero waiting for host**.

### ✅ Already Built Files:
- `backend/code/services/google_meet_service.py` — Calls `POST https://meet.googleapis.com/v2/spaces` with `accessType: OPEN`, `entryPointAccess: ALL`, `moderation: OFF`.
- `backend/scripts/google_meet_auth_setup.py` — 1-time interactive OAuth2 setup script (saves `GOOGLE_MEET_CLIENT_ID`, `GOOGLE_MEET_CLIENT_SECRET`, `GOOGLE_MEET_REFRESH_TOKEN` to `backend/.env` and verifies live OPEN room creation).
- `backend/code/meetings/routes.py` — `GET /meetings/meet/config`, `POST /meetings/meet/test`, and upgraded `POST /meetings/meet/schedule` (auto-creates room when `meeting_url` is blank).
- `backend/code/services/email_service.py` — Google Meet invite email uses 1-Click Launcher (`/meetings/launch?username=...`).
- `src/app/pages/admin/components/student-timetable-modal.component.ts` — Meet URL input is optional (leave blank to auto-create).

### 🔧 Tomorrow's 5-Minute One-Time Workspace Setup Checklist:
1. Open [Google Cloud Console](https://console.cloud.google.com) under your **Google Workspace / Enterprise** project:
   - Go to **APIs & Services → Library → Search `Google Meet REST API` → Click Enable**.
   - Go to **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
     - Application type: **Desktop app** *(or **Web application** with Authorized redirect URI: `http://localhost:8765/callback`)*.
     - Copy the generated **Client ID** and **Client Secret**.
2. Open [Google Workspace Admin Console](https://admin.google.com):
   - Navigate to **Apps → Google Workspace → Google Meet → Meet safety settings**.
   - Ensure **"Host must join before anyone else"** is **OFF** and external/open access is allowed.
3. Run the 1-time setup script from `d:\code\Interview`:
   ```powershell
   backend\.venv\Scripts\python.exe backend\scripts\google_meet_auth_setup.py
   ```
   - Paste `Client ID` & `Client Secret` ➔ Sign in once with your **Enterprise / Workspace** account in the browser.
   - The script automatically writes these keys into `backend/.env`:
     ```ini
     GOOGLE_MEET_CLIENT_ID="..."
     GOOGLE_MEET_CLIENT_SECRET="..."
     GOOGLE_MEET_REFRESH_TOKEN="..."
     ```
   - Restart FastAPI backend (`uvicorn`), then test scheduling **🌐 Meet** with a blank URL in Admin Dashboard!



---

## 🐛 Backlog / Future Fix: Zoom Bot Sidebar Split View (Auto-Close "Participants (1)" Panel)

### 📌 Problem Description (Reported with Screenshot)
When the AI Interviewer bot launches and joins the Zoom Web Client (`app.zoom.us/wc/...`):
1. Zoom Web Client automatically opens **both** the **Participants Panel** and the **Chat Panel** stacked vertically in the right-hand sidebar.
2. **Top Half:** `Participants (1)` panel (showing host/bot name, Invite, Mute All, More).
3. **Bottom Half:** `Chat Panel` (compressed into the remaining 50% height).
4. **Impact:**
   - Because the chat is compressed into a tiny vertical viewport, Zoom's React virtualized list has restricted height, causing new incoming messages from the candidate not to mount or refresh smoothly.
   - When the user manually clicks the **`✕` (Close)** button on the top-right of the **Participants (1)** header, the Participants panel closes.
   - The Chat Panel then instantly expands to the **full 100% sidebar height**, allowing messages to render and refresh perfectly!

### 💡 Planned Solution (To Implement in Future)
In `backend/code/self_hosted_bot/adapters/zoom_web.py` (inside `open_chat()` or post-join):
- Add a quick check to detect if the Participants panel is currently open in split view:
  ```javascript
  // Close the Participants panel so Chat gets 100% full height
  const closePartBtn = document.querySelector('.participants-header__close, button[aria-label*="close participants" i], .participants-wrapper button.close');
  if (closePartBtn) closePartBtn.click();
  ```
- Alternatively, ensure only the Chat button on the bottom toolbar is active, automatically giving Chat 100% sidebar height.


---

## 🐛 Backlog / Future Fix: Google Meet "Meeting Details" Side Drawer Toggle Loop

### 📌 Problem Description (Reported with Screenshot)
In Google Meet (`meet.google.com/...`):
1. The right sidebar drawer is a **single shared panel** that can show only ONE tab at a time:
   - **Meeting details** (info tab / `ℹ️`)
   - **People** (participant list / `👥`)
   - **Chat with everyone** (in-call messages / `💬`)
   - **Activities** (whiteboard, polls, etc.)
2. If the "Meeting details" panel is opened (by default upon meeting start or accidental click):
   - The Chat panel is inactive/hidden, so `is_chat_open()` in `google_meet.py` returns `False`.
   - In `read_new_messages()`, the bot detects that chat is closed and attempts to call `open_chat()`.
   - If user/host tries to close or switch the panel while the bot calls `open_chat()`, the drawer can toggle open/close repeatedly between "Meeting details" and "Chat".
3. Once the user closed it or the bot secured the chat panel, it settled and worked normally.

### 💡 Planned Solution (To Implement in Future)
In `backend/code/self_hosted_bot/adapters/google_meet.py`:
- Add a debounce / cooldown (e.g. at least 5 seconds between `open_chat()` attempts) so the bot does not fight with user interactions if they open "Meeting details".
- Explicitly check if another panel like `div[aria-label*="Meeting details" i]` is open before blindly re-triggering chat toggle clicks.
- Prioritize targeting the exact Chat tab button `button[aria-label*="Chat with everyone" i]` directly rather than generic drawer selectors.


---

## 🌐 Research & Architecture: Permanent Static Tunnel Comparison (Ngrok vs Cloudflare)

### 📌 The Problem
Currently, Cloudflare Quick Tunnel (`cloudflared tunnel --url http://localhost:8001`) generates a new random subdomain on every restart (e.g., `https://wife-struggle-elected-everywhere.trycloudflare.com`).
As a result, `PUBLIC_BASE_URL` in `backend/.env` has to be updated manually every time the tunnel restarts.

### 🔍 Solution Comparison: Ngrok vs Cloudflare

| Feature | **Ngrok Free Static Domain** (Recommended for Zero-Domain Setup) | **Cloudflare Named Tunnel** (Recommended for Custom Domain) | **Cloudflare Quick Tunnel** (Current Setup) |
|---|---|---|---|
| **URL Stability** | **100% Permanent Static Domain** (`*.ngrok-free.app`) | **100% Permanent Static Subdomain** (`api.yourdomain.com`) | Random on every restart (`*.trycloudflare.com`) |
| **Need to update `.env`?** | **NO — Set once forever** | **NO — Set once forever** | **YES — Update on every restart** |
| **Cost** | **₹0 Free** (1 static domain included in free account) | **₹0 Free** | **₹0 Free** |
| **Domain Requirement** | No custom domain needed (assigned by ngrok) | Requires owning any domain connected to Cloudflare | None |
| **Browser Warning Page** | Free tier shows a 1-time "Visit Site" interstitial banner in browser | None (seamless enterprise experience) | None |
| **Command** | `ngrok http 8001 --domain=your-name.ngrok-free.app` | `cloudflared tunnel run <tunnel-name>` | `cloudflared tunnel --url http://localhost:8001` |

### 🎯 Recommendation
1. **If you want zero-configuration permanent URL without buying a domain:**  
   Use **Ngrok Free Static Domain**. Claim 1 free static domain from your ngrok dashboard, configure it once in `backend/.env`, and you will never need to update `.env` again.
2. **If you have a custom domain:**  
   Configure a **Cloudflare Named Tunnel** for permanent static routing with zero warning pages.
