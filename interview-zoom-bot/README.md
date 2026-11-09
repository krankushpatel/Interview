# Zoom Interview Bot (prototype)

Student sirf **Zoom** use karta hai. Bot meeting chat mein question bhejta hai, student mic se bolta hai
(Deepgram transcript), aur chat mein `/submit` `/skip` `/clear` likh kar control karta hai.
Per-question timer admin decide karta hai (default 5 min).

```
Student (Zoom) ──voice──▶ Recall bot ──Deepgram──▶ webhook ──▶ THIS SERVER (state machine + timer + DB)
      ▲   chat: Q1.., "✅ Saved"                                         │
      └────────────── send_chat_message ◀─────────────────────────────────┘
                                                                         └─▶ WebSocket /ws/admin ─▶ admin live view
```

## 1. Bina Zoom ke test (2 minute)

```bash
python -m venv venv && source venv/bin/activate      # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --port 8000                     # RECALL_API_KEY khali = MOCK mode
python simulate.py                                   # dusre terminal mein: fake student, 25 checks
```
`http://localhost:8000/admin` kholo: interview banao aur live view dekho (simulate.py bhi dikhega).

## 2. Real Zoom ke saath

1. **Recall.ai** account banao, API key lo, `.env` mein `RECALL_API_KEY` aur `RECALL_REGION` daalo.
2. **Deepgram key** Recall dashboard mein add karo (Transcription settings). `.env` mein sirf model/language hota hai.
3. **Public URL**: `ngrok http 8000` → https URL `PUBLIC_BASE_URL` mein. (Webhook yahin aayega.)
4. **Zoom authorization** (sabse zaroori, neeche dekho).
5. `cp .env.example .env`, values bharo, `uvicorn app.main:app --port 8000`.
6. Admin page se interview banao (meeting URL daalo) → bot meeting join karega.
7. Student join kare → welcome message → student chat mein `/start` likhe.

### Zoom meeting settings (host account)
- Waiting room **off** (ya bot/student ko allow karo).
- Chat **on**, participants ko chat allowed (everyone).
- Captions/Live transcript **on** (student ko live text dikhane ke liye: Show Subtitle).
- Bot ko spotlight ya co-host ki zaroorat nahi.

### Zoom authorization
Zoom ab bots ke liye ZAK/OBF token maangta hai. Recall docs ("Zoom OBF" / "Skip waiting room") ke hisaab se:
- Zoom **General app** banao (Meeting SDK enable, scope `user:read:token`), Client ID/Secret Recall dashboard (Meeting Bot Setup → Zoom) mein daalo.
- Ek chhota callback endpoint host karna padta hai jo OBF/ZAK token return kare, uska URL `.env` mein `ZOOM_OBF_TOKEN_URL` (ya `ZOOM_ZAK_URL`) mein.
- Custom SDK credentials ke liye Recall support se workspace enable karwana pad sakta hai.
Ye step pehle test karo, baaki sab iske baad hai.

## 3. Student ka flow
| Student kya karta hai | Bot kya karta hai |
|---|---|
| Zoom join | Welcome + instructions |
| chat: `/start` | Q1 bhejta hai, timer start |
| bolta hai | Deepgram text buffer mein jaata hai |
| `/clear` | Current answer mita deta hai |
| `/submit` | Answer save, "✅ Saved: ..." echo, next question |
| `/skip` | Skip save, next question |
| (time khatam) | 60s pehle reminder; phir auto-submit aur next question |
| `/show` `/repeat` `/help` | Extra helpers |

- `/start` **student** hi likhe: jo `/start` likhta hai wahi student maana jaata hai (sirf uski awaaz/commands count hote hain). Host ke commands ignore hote hain.
- Chat mein typed answer count nahi hota, sirf audio transcript.
- Student ne sentence ke beech `/submit` kiya to last partial text bhi save hota hai. Submit ke baad aane wala purana final text timestamp se filter hota hai.

## 4. Apne platform mein jodna
Tumhara WebSocket/WebRTC student side ke liye zaroori nahi (Zoom media sambhalta hai). Use karo:
- `POST /api/interviews` — admin interview schedule kare tab call karo:
  ```json
  {"candidate_name":"Ravi","meeting_url":"https://zoom.us/j/...","time_limit_sec":300,
   "questions":["Tell me about yourself", {"text":"Explain REST","time_limit_sec":180}]}
  ```
  `time_limit_sec` = admin ka default; har question ka alag limit bhi de sakte ho.
- `GET /api/interviews/{id}` — live state + saved answers (score/evaluation ke liye).
- `WS /ws/admin?interview_id=...` — live events (`question`, `transcript`, `chat`, `answer_saved`, `completed`) apne admin panel ke WebSocket mein relay kar sakte ho.
- `POST /api/interviews/{id}/end` — admin force end.
- `ADMIN_KEY` set karo to `/api/*` aur `/ws/admin` ko `?key=` ya `X-Admin-Key` chahiye.

## 5. Pehli real run mein verify karne wali cheezein
Ye mock mein pass hain, lekin Zoom/Recall ke saath live confirm karni hain. Debug ke liye `data/events.jsonl` aur `GET /api/debug/events` mein raw webhook JSON milta hai; mismatch ho to wahi paste karo.
1. Webhook payload fields (`participant.id`, `is_host`, chat `data.text`, transcript `words`) docs ke schema se match karte hain.
2. `leave_call` endpoint ka path (bot auto-leave ke liye); fail hone par sirf warning log hoti hai.
3. `PERFECT_DIARIZATION` ka key name (`diarization.use_separate_streams_when_available`); galat ho to bot create 400 dega, tab `false` kar do.
4. Deepgram `language=multi` Hindi+English ke liye; accuracy test karo. `en`/`hi` bhi try kar sakte ho.
5. `CHAT_MODE=dm` (private question) sirf Zoom mein chalta hai aur chat settings par depend karta hai.
6. Web client / mobile par chat aur captions.

## Limits (prototype)
- In-memory sessions: server restart par chal rahe interview ka state jaata hai (answers/DB bacha rehta hai).
- Proctoring (face/speaker), screen share, consent notice abhi shamil nahi.
- Recording/transcription ka consent student ko pehle batao.
- Ek process, single server; scale ke liye state Redis/DB mein le jaana hoga.

## Files
```
app/main.py      REST + webhook + websocket
app/engine.py    state machine: commands, timer, transcript buffer
app/recall.py    Recall client (+ mock) and bot payload (Deepgram config)
app/db.py        SQLite (interviews, answers)
app/hub.py       WebSocket broadcast
app/static/admin.html   demo admin live view
simulate.py      end-to-end fake-student test
```
