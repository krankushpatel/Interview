from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from code.audio.vad_processor import VADProcessor
from code.audio.diarization import DiarizationDetector
from code.proctoring.manager import log_proctoring_event
from code.recording.websocket_handlers import router as deepgram_router
from code.core.data_manager import db
# from code.audio.noise_filter import NoiseFilter
import asyncio
import json
import os
import re
import subprocess
import aiohttp
import numpy as np
from resemblyzer import VoiceEncoder, preprocess_wav
from pathlib import Path
import io
import soundfile as sf
from fastapi import UploadFile, File, Form

DEEPGRAM_API_KEY = os.getenv("DEEPGRAM_API_KEY")
DEEPGRAM_MODEL = os.getenv("DEEPGRAM_MODEL", "nova-2")

router = APIRouter()
router.include_router(deepgram_router)


# ============================================================
# STT keyterm hygiene — generic, data-driven (no hardcoded terms).
# Keywords come from the database; this only cleans them so that
# Deepgram's bias goes to the terms that actually need it.
#   * common English words (take, high, off...) are dropped: they are already
#     recognised well, and boosting them hurts (e.g. "Tech" -> "Take")
#   * rare terms / acronyms are placed first so they survive the size cap
#   * case-insensitive dedupe, keeping the variant with more capitals
# Tunable via env: STT_KEYTERM_COMMON_ZIPF (default 5.0, higher = keep more).
# ============================================================
try:
    from wordfreq import zipf_frequency
except ImportError:  # optional dependency: pip install wordfreq
    zipf_frequency = None
    print("[STT] wordfreq not installed — common-word filtering for keyterms is OFF")

# Periodic "[STT][diag]" logging is OFF by default; enable with STT_DIAG=1 when debugging
STT_DIAG = os.getenv("STT_DIAG", "0") == "1"

# /ws/diarize used to write "multiple_speakers_detected" to MongoDB itself (without a
# session id) while the frontend ALSO logged the same incident (addProctorLog, with
# session id) -> each incident was stored twice and counted twice by analyze_behavior().
# The frontend is now the single writer (it receives the exact reason in the
# "audio_violation" message). Set DIARIZE_BACKEND_DB_LOG=1 to let the backend write as well;
# it will then include the session_id sent in the init message.
DIARIZE_BACKEND_DB_LOG = os.getenv("DIARIZE_BACKEND_DB_LOG", "0") == "1"
KEYTERM_COMMON_ZIPF = float(os.getenv("STT_KEYTERM_COMMON_ZIPF", "5.0"))
KEYTERM_MAX_NOVA3 = int(os.getenv("STT_KEYTERM_MAX_NOVA3", "50"))
KEYWORDS_MAX_LEGACY = int(os.getenv("STT_KEYWORDS_MAX_LEGACY", "100"))


def _term_rarity(term: str) -> float:
    """Lower = rarer. For phrases the rarest word decides. Unknown -> 0 (rarest)."""
    if zipf_frequency is None:
        return 0.0
    words = re.findall(r"[A-Za-z0-9]+", term.lower())
    if not words:
        return 0.0
    return min(zipf_frequency(w, "en") for w in words)


def sanitize_keyterms(raw_items, limit: int):
    """Returns (cleaned_terms, dropped_common_terms)."""
    best: dict = {}
    for item in raw_items:
        for kw in item.split(","):
            term = " ".join(kw.strip().replace(":", " ").split())
            if len(term) < 2 or term.isdigit():
                continue
            key = term.lower()
            prev = best.get(key)
            if prev is None or sum(c.isupper() for c in term) > sum(c.isupper() for c in prev):
                best[key] = term

    terms = list(best.values())
    dropped = []
    if zipf_frequency is not None:
        kept = []
        for t in terms:
            (dropped if _term_rarity(t) >= KEYTERM_COMMON_ZIPF else kept).append(t)
        terms = kept
    terms.sort(key=_term_rarity)  # stable: rarest first
    return terms[:limit], dropped


# ============================================================
# Audio decoding for speaker endpoints.
# Browsers record with MediaRecorder -> webm/opus (Chrome/Firefox) or mp4/aac
# (Safari). libsndfile (soundfile) cannot read those containers, which caused
# "Format not recognised". We try, in order:
#   1) soundfile  (wav / flac / ogg)            - fast path
#   2) PyAV       (webm/opus, mp4/aac, ...)     - pip install av  (ships its own ffmpeg libs)
#   3) ffmpeg CLI (if installed on the server)
# Always returns float32 mono @ 16 kHz (resemblyzer requirement).
# ============================================================
SPEAKER_SAMPLE_RATE = 16000


def _to_16k_mono(data: np.ndarray, sample_rate: int) -> np.ndarray:
    if data.ndim > 1:
        data = data.mean(axis=1)
    if sample_rate != SPEAKER_SAMPLE_RATE:
        import librosa
        data = librosa.resample(data, orig_sr=sample_rate, target_sr=SPEAKER_SAMPLE_RATE)
    return np.ascontiguousarray(data, dtype=np.float32)


def _decode_with_pyav(audio_bytes: bytes) -> np.ndarray:
    import av  # optional dependency
    parts = []
    with av.open(io.BytesIO(audio_bytes)) as container:
        stream = next((st for st in container.streams if st.type == "audio"), None)
        if stream is None:
            raise ValueError("no audio stream found")
        resampler = av.AudioResampler(format="flt", layout="mono", rate=SPEAKER_SAMPLE_RATE)

        def _collect(out):
            for f in (out if isinstance(out, list) else [out]):
                if f is not None:
                    parts.append(f.to_ndarray().reshape(-1))

        for frame in container.decode(stream):
            _collect(resampler.resample(frame))
        _collect(resampler.resample(None))  # flush
    if not parts:
        raise ValueError("decoded 0 samples")
    return np.concatenate(parts).astype(np.float32)


def _decode_with_ffmpeg_cli(audio_bytes: bytes) -> np.ndarray:
    proc = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", "pipe:0", "-f", "f32le", "-ac", "1",
         "-ar", str(SPEAKER_SAMPLE_RATE), "pipe:1"],
        input=audio_bytes, capture_output=True, timeout=15,
    )
    if proc.returncode != 0 or not proc.stdout:
        raise ValueError(proc.stderr.decode(errors="ignore").strip()[:200] or "ffmpeg produced no output")
    return np.frombuffer(proc.stdout, dtype=np.float32).copy()


def decode_audio_to_16k_mono(audio_bytes: bytes) -> np.ndarray:
    errors = []
    try:
        data, sr = sf.read(io.BytesIO(audio_bytes), dtype="float32")
        return _to_16k_mono(data, sr)
    except Exception as e:
        errors.append(f"soundfile: {e}")
    for name, fn in (("pyav", _decode_with_pyav), ("ffmpeg", _decode_with_ffmpeg_cli)):
        try:
            return fn(audio_bytes)
        except Exception as e:
            errors.append(f"{name}: {e}")
    raise ValueError("Could not decode audio (" + " | ".join(errors) + ")")

enrolled_speakers = {}
voice_encoder = VoiceEncoder()

@router.websocket("/ws/diarize")
async def websocket_hybrid_diarize(websocket: WebSocket):
    """Hybrid diarization system combining Silero VAD + Deepgram AI tracking"""
    await websocket.accept()

    # Declare variables up front to avoid UnboundLocalError in finally block
    username   = None
    session_id = None
    dg_session = None
    dg_ws      = None
    ai_task    = None

    diarization_detector     = DiarizationDetector()
    current_speaker_id       = None
    last_speaker_change_time = None
    TURN_DETECTION_THRESHOLD = 2.0

    try:
        init_msg = await websocket.receive_text()
        data     = json.loads(init_msg)
        username = data.get("username", "unknown")
        session_id = data.get("session_id") or None
        print(f"[HYBRID] Monitoring started for: {username} (session: {session_id})")
        print(f"[HYBRID] Turn-taking threshold: {TURN_DETECTION_THRESHOLD}s")

        vad_processor        = VADProcessor()
        audio_buffer         = bytearray()
        frame_bytes          = vad_processor.frame_bytes
        segment_energy_history: list[float] = []
        segment_active       = False

        DEEPGRAM_API_KEY = os.getenv("DEEPGRAM_API_KEY")

        if not DEEPGRAM_API_KEY:
            print("[AUDIO] ⚠️  DEEPGRAM_API_KEY missing — /ws/stt-stream will reject clients (they fall back to webkit)")
        else:
            print("[HYBRID] 🔑 Using Deepgram API key from environment")

        if DEEPGRAM_API_KEY:
            try:
                dg_session = aiohttp.ClientSession()
                dg_url = (
                    f"wss://api.deepgram.com/v1/listen"
                    f"?model={DEEPGRAM_MODEL}&diarize=true&sample_rate=16000&encoding=linear16"
                )
                dg_ws = await dg_session.ws_connect(
                    dg_url,
                    headers={"Authorization": f"Token {DEEPGRAM_API_KEY}"},
                )
                print("[HYBRID] Deepgram AI Active — Tracking Turn-Taking scenarios")
            except Exception as e:
                print(f"[HYBRID] Deepgram setup failed: {e}")
        else:
            print("[HYBRID] WARNING: DEEPGRAM_API_KEY not set. AI diarization disabled.")

        last_ai_trigger_time = 0.0

        # ── Deepgram response handler ──────────────────────────────────────
        async def handle_ai_responses():
            nonlocal last_ai_trigger_time, current_speaker_id, last_speaker_change_time
            if not dg_ws:
                return
            try:
                async for msg in dg_ws:
                    if msg.type == aiohttp.WSMsgType.TEXT:
                        res   = json.loads(msg.data)
                        words = (
                            res.get("channel", {})
                               .get("alternatives", [{}])[0]
                               .get("words", [])
                        )
                        current_time = asyncio.get_event_loop().time()

                        speakers_in_message: set[int] = set()
                        for w in words:
                            spk_id = w.get("speaker")
                            if spk_id is not None:
                                speakers_in_message.add(spk_id)
                                diarization_detector.add_speaker(spk_id)

                        # SCENARIO 1: Simultaneous overlap within a single data window
                        if len(speakers_in_message) > 1:
                            if current_time - last_ai_trigger_time > 5.0:
                                last_ai_trigger_time = current_time
                                speaker_list         = sorted(speakers_in_message)
                                print(
                                    f"[HYBRID] ⚠️ SCENARIO 1 — SIMULTANEOUS OVERLAP "
                                    f"FOR {username}: {speaker_list}"
                                )
                                reason = f"Simultaneous: {speaker_list}"
                                if DIARIZE_BACKEND_DB_LOG:
                                    await log_proctoring_event(
                                        username, "multiple_speakers_detected", reason, session_id
                                    )
                                await websocket.send_json({
                                    "type":     "audio_violation",
                                    "level":    "high",
                                    "source":   "AI",
                                    "scenario": "simultaneous",
                                    "detail":   reason,
                                })

                        # SCENARIO 2: Persistent speaker switch → turn-taking
                        elif len(speakers_in_message) == 1:
                            new_speaker = next(iter(speakers_in_message))
                            if current_speaker_id is not None and new_speaker != current_speaker_id:
                                time_gap = (
                                    current_time - last_speaker_change_time
                                    if last_speaker_change_time
                                    else TURN_DETECTION_THRESHOLD + 1
                                )
                                if time_gap < TURN_DETECTION_THRESHOLD:
                                    if current_time - last_ai_trigger_time > 5.0:
                                        last_ai_trigger_time = current_time
                                        print(
                                            f"[HYBRID] ⚠️ SCENARIO 2 — QUICK TURN-TAKING "
                                            f"FOR {username}: "
                                            f"{current_speaker_id} -> {new_speaker}"
                                        )
                                        reason = (
                                            f"Turn-taking: {current_speaker_id}->{new_speaker} "
                                            f"(changed in {time_gap:.1f}s)"
                                        )
                                        if DIARIZE_BACKEND_DB_LOG:
                                            await log_proctoring_event(
                                                username, "multiple_speakers_detected", reason, session_id
                                            )
                                        await websocket.send_json({
                                            "type":     "audio_violation",
                                            "level":    "high",
                                            "source":   "AI",
                                            "scenario": "turn_taking",
                                            "detail":   reason,
                                        })
                            current_speaker_id       = new_speaker
                            last_speaker_change_time = current_time
            except Exception as e:
                print(f"[HYBRID] AI response handling loop error: {e}")

        ai_task = asyncio.create_task(handle_ai_responses())

        # ── Main audio receive loop ────────────────────────────────────────
        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                print(f"[HYBRID] Client closed socket link cleanly for: {username}")
                break

            text_data  = message.get("text")
            bytes_data = message.get("bytes")

            # ── Control messages (ping / init) ─────────────────────────────
            if text_data is not None:
                try:
                    ctrl = json.loads(text_data)
                    if ctrl.get("type") == "ping":
                        await websocket.send_json({"type": "pong"})
                except json.JSONDecodeError:
                    pass
                continue

            if bytes_data is None:
                continue

            chunk = bytes_data

            # Forward raw bytes to Deepgram in parallel
            if dg_ws and not dg_ws.closed:
                await dg_ws.send_bytes(chunk)

            # ── Accumulate and slice into exact Silero frames ──────────────
            audio_buffer.extend(chunk)
            while len(audio_buffer) >= frame_bytes:
                frame        = audio_buffer[:frame_bytes]
                audio_buffer = audio_buffer[frame_bytes:]

                is_speech, energy, zcr, speech_prob = vad_processor.process_frame(frame)

                if speech_prob < 0.30:
                    # Pure noise / silence — reset segment and skip
                    segment_active         = False
                    segment_energy_history = []
                    vad_processor.speech_buffer.append(0)
                    continue

                # ── Read the confusion flag BEFORE updating speech_buffer ──
                # This must happen on every non-dropped frame so PATH 1 of
                # DiarizationDetector gets correct data even when speech_prob
                # is in the confused zone (0.35–0.60).
                silero_confused = vad_processor.silero_confusion_zone

                # ── Activity buffer ────────────────────────────────────────
                vad_processor.speech_buffer.append(1 if is_speech else 0)
                if len(vad_processor.speech_buffer) < 5:
                    continue

                is_active = (
                    sum(vad_processor.speech_buffer)
                    / len(vad_processor.speech_buffer)
                ) > 0.3

                if not is_active:
                    segment_active         = False
                    segment_energy_history = []
                    continue

                # ── Segment onset ──────────────────────────────────────────
                if not segment_active:
                    segment_active         = True
                    segment_energy_history = [energy]
                    continue

                segment_energy_history.append(energy)

                if len(segment_energy_history) < 8:
                    continue

                # ── Exponential-weighted statistics ───────────────────────
                # Focus evaluation on the most recent frames (higher weight).
                recent_frames = segment_energy_history[-30:]
                weights       = [1.5 ** (i / 15.0) for i in range(len(recent_frames))]
                total_weight  = sum(weights)

                recent_avg = (
                    sum(e * w for e, w in zip(recent_frames, weights)) / total_weight
                )
                variance = (
                    sum(
                        ((x - recent_avg) ** 2) * w
                        for x, w in zip(recent_frames, weights)
                    )
                    / total_weight
                )
                    
                # ── LOCAL VAD detection — now with silero_confused flag ────
                if diarization_detector.detect_multiple_speakers(
                    energy,
                    recent_avg,
                    variance,
                    zcr,
                    silero_confused,   # ← NEW: wires PATH 1 of DiarizationDetector
                ):
                    print(
                        f"[HYBRID] ⚠️ LOCAL VAD DETECTED OVERLAPPING SPEECH "
                        f"FOR {username}"
                    )
                    reason = "local VAD simultaneous"
                    if DIARIZE_BACKEND_DB_LOG:
                        await log_proctoring_event(
                            username, "multiple_speakers_detected", reason, session_id
                        )
                    await websocket.send_json({
                        "type":     "audio_violation",
                        "level":    "high",
                        "source":   "LOCAL",
                        "scenario": "simultaneous",
                        "detail":   reason,
                    })

    except Exception as e:
        print(f"[HYBRID] Execution loop error: {e}")
    finally:
        if ai_task and not ai_task.done():
            ai_task.cancel()
        if dg_ws:
            await dg_ws.close()
        if dg_session:
            await dg_session.close()
        try:
            await websocket.close()
        except Exception:
            pass

@router.post("/speaker/enroll")
async def speaker_enroll(username: str = Form(...), audio: UploadFile = File(...)):
    """Enroll a speaker's voiceprint for later verification (voice mismatch check)."""
    try:
        audio_bytes = await audio.read()
        # Decode any supported format (wav/flac/ogg, browser webm/opus, mp4/aac) -> 16kHz mono float32
        loop = asyncio.get_running_loop()
        audio_np = await loop.run_in_executor(None, decode_audio_to_16k_mono, audio_bytes)
        sample_rate = SPEAKER_SAMPLE_RATE

        if len(audio_np) < sample_rate * 1.6:
            return {"success": False, "message": f"Audio too short ({len(audio_np)/sample_rate:.1f}s). Need at least 1.6s."}

        embedding = voice_encoder.embed_utterance(audio_np)
        enrolled_speakers[username] = embedding
        try:
            db.speaker_embeddings.update_one(
                {"username": username},
                {"$set": {"username": username, "embedding": embedding.tolist()}},
                upsert=True
            )
        except Exception as e_db:
            print(f"[SPEAKER] Mongo persist warning: {e_db}")
        print(f"[SPEAKER] ✅ Enrolled voiceprint for {username} (saved to DB and memory, dim={embedding.shape})")
        return {"success": True, "message": "Voiceprint enrolled", "embedding_dim": embedding.shape[0]}

    except Exception as e:
        print(f"[SPEAKER] Enroll error for {username}: {e}")
        return {"success": False, "message": str(e)}

@router.post("/speaker/verify")
async def verify_speaker(
    username: str = Form(...),
    audio: UploadFile = File(...)
):
    """
    Verification endpoint: Receives a short audio chunk, compares with enrolled voice.
    Checks memory cache, then MongoDB, or auto-enrolls if chunk is >= 1.6s.
    """
    global enrolled_speakers, voice_encoder
    
    # 1. Check memory cache or load from MongoDB
    if username not in enrolled_speakers:
        try:
            doc = db.speaker_embeddings.find_one({"username": username})
            if doc and "embedding" in doc:
                enrolled_speakers[username] = np.array(doc["embedding"], dtype=np.float32)
                print(f"[Speaker] ✅ Restored voiceprint for {username} from MongoDB")
        except Exception as e_db:
            print(f"[Speaker] Mongo lookup error: {e_db}")

    try:
        # Read and decode audio (wav/flac/ogg, or browser webm/opus & mp4/aac) -> 16kHz mono float32
        audio_bytes = await audio.read()
        loop = asyncio.get_running_loop()
        audio_np = await loop.run_in_executor(None, decode_audio_to_16k_mono, audio_bytes)
        sample_rate = SPEAKER_SAMPLE_RATE

        # Auto-enroll if still not enrolled and chunk is long enough
        if username not in enrolled_speakers:
            if len(audio_np) >= sample_rate * 1.6:
                chunk_embedding = voice_encoder.embed_utterance(audio_np)
                enrolled_speakers[username] = chunk_embedding
                try:
                    db.speaker_embeddings.update_one(
                        {"username": username},
                        {"$set": {"username": username, "embedding": chunk_embedding.tolist()}},
                        upsert=True
                    )
                except Exception:
                    pass
                print(f"[Speaker] 🎙️ Auto-enrolled voiceprint for {username} from live audio! (dim={chunk_embedding.shape})")
                return {"success": True, "is_same": True, "similarity": 1.0, "message": "Voiceprint auto-enrolled successfully"}
            else:
                print(f"[Speaker] Verify {username}: Enrolling voiceprint pending ({len(audio_np)/sample_rate:.1f}s sample) - BYPASSED")
                return {"success": False, "is_same": True, "similarity": 1.0, "message": "User not enrolled"}
        
        # Extract embedding for the chunk
        chunk_embedding = voice_encoder.embed_utterance(audio_np)
        ref_embedding = enrolled_speakers[username]
        
        # Calculate Cosine Similarity
        similarity = np.dot(ref_embedding, chunk_embedding) / (
            np.linalg.norm(ref_embedding) * np.linalg.norm(chunk_embedding)
        )
        
        # Threshold: >= 0.70 means same person
        actual_is_same = bool(similarity >= 0.70)
        
        print(f"[Speaker] Verify {username}: Similarity={similarity:.3f}, Match={actual_is_same}")
        
        return {
            "success": True, 
            "is_same": True,   # TODO: change after frontend works actal_is_same   
            "similarity": float(similarity)
        }
        
    except Exception as e:
        print(f"[Speaker] Verification error for {username}: {e}")
        return {"success": False, "is_same": True, "similarity": 1.0, "message": str(e)}
    
# ============================================================
# NEW: Primary STT endpoint — Deepgram 2 streaming
# ============================================================
@router.websocket("/ws/stt-stream/{username}/{session_id}")
async def stt_stream(websocket: WebSocket, username: str, session_id: str):
    """
    PRIMARY STT — Deepgram nova-3 streaming.
    Accepts raw 16kHz mono linear16 PCM from the browser AudioWorklet.
    Returns partial + final transcripts with confidence scores.
    Also runs diarize=true so speaker labels are available (supplements /ws/diarize).

    FALLBACK: If DEEPGRAM_API_KEY is missing or connection fails, sends
    {"type":"fallback","reason":"..."} and closes — client switches to webkitSpeechRecognition.
    """
    await websocket.accept()

    # Guard 1: Dynamic check for API key
    dg_key = (os.getenv("DEEPGRAM_API_KEY") or "").strip()
    if not dg_key:
        print("\n" + "!" * 80)
        print("❌ [DEEPGRAM STT ERROR] Client connected to /ws/stt-stream but DEEPGRAM_API_KEY is MISSING in environment / .env!")
        print("   Client will automatically fallback to browser webkitSpeechRecognition.")
        print("!" * 80 + "\n")
        await websocket.send_json({"type": "fallback", "reason": "no_deepgram_key"})
        await websocket.close()
        return

    # Guard 2: connect to Deepgram
    dg_model = websocket.query_params.get("model") or DEEPGRAM_MODEL
    punctuate = websocket.query_params.get("punctuate", "true")
    smart_format = websocket.query_params.get("smart_format", "true")
    endpointing = websocket.query_params.get("endpointing", "150")
    utterance_end_ms = websocket.query_params.get("utterance_end_ms", "800")
    keyword_boost = websocket.query_params.get("keyword_boost", "6.0")

    # Nova-3 does NOT support the legacy `keywords` param (HTTP 400).
    # It uses `keyterm` instead (plain terms, no ":boost" suffix).
    is_nova3 = dg_model.lower().startswith("nova-3")

    raw_keywords = websocket.query_params.getlist("keywords")
    keywords, dropped_common = sanitize_keyterms(
        raw_keywords, KEYTERM_MAX_NOVA3 if is_nova3 else KEYWORDS_MAX_LEGACY
    )
    if dropped_common:
        print(f"[STT] Skipped {len(dropped_common)} common-word keyterms: {dropped_common}")

    dg_params = {
        "model": dg_model,
        "language": "en-IN",
        "smart_format": smart_format,
        "punctuate": punctuate,
        "diarize": "true",
        "numerals": "true",
        "filler_words": "false",
        "profanity_filter": "false",
        "endpointing": endpointing,
        "utterance_end_ms": utterance_end_ms,
        "vad_events": "true",
        "interim_results": "true",
        "encoding": "linear16",
        "sample_rate": "16000",
        "channels": "1",
    }
    if keywords:
        if is_nova3:
            dg_params["keyterm"] = keywords
        else:
            dg_params["keywords"] = [f"{kw}:{keyword_boost}" for kw in keywords]

    # Try with keywords/keyterm first; if Deepgram rejects the handshake
    # (e.g. 400), retry once WITHOUT them so STT never breaks.
    dg_session = aiohttp.ClientSession()
    dg_ws = None
    last_err = None
    base_params = {k: v for k, v in dg_params.items() if k not in ("keyterm", "keywords")}
    attempts = [dg_params, base_params] if keywords else [dg_params]

    for i, attempt_params in enumerate(attempts):
        try:
            dg_ws = await dg_session.ws_connect(
                "wss://api.deepgram.com/v1/listen",
                headers={"Authorization": f"Token {dg_key}"},
                params=attempt_params,
            )
            if i == 1:
                print("[STT] ⚠️ Connected WITHOUT keywords (retry after handshake failure)")
                keywords = []
            break
        except Exception as e:
            last_err = e
            err_headers = getattr(e, "headers", None)
            dg_err = err_headers.get("dg-error") if err_headers else None
            print(f"[STT] Deepgram connect attempt {i + 1} failed: {e} | dg-error: {dg_err}")

    if dg_ws is None:
        print("\n" + "!" * 80)
        print(f"❌ [DEEPGRAM STT CONNECTION FAILED] User: {username} | Error: {last_err}")
        print(f"   Key length: {len(dg_key)} | First 6 chars: '{dg_key[:6]}...'")
        print("   Client will automatically fallback to browser webkitSpeechRecognition.")
        print("!" * 80 + "\n")
        await websocket.send_json({"type": "fallback", "reason": f"deepgram_connect_failed: {str(last_err)}"})
        try: await dg_session.close()
        except: pass
        await websocket.close()
        return


    print("\n" + "="*80)
    print(f"🎤 [DEEPGRAM STT CONNECTED] User: '{username}' | Session: '{session_id}'")
    print(f"⚙️ Model: {dg_model} | Language: en-IN | Boost: {keyword_boost}")
    print(f"🔑 Total Keywords Sent to Deepgram ({len(keywords)}):")
    if keywords:
        print(f"   {keywords}")
    else:
        print("   (No keywords provided)")
    print("="*80 + "\n")

    # Inform client that connection was established
    await websocket.send_json({
        "type": "connected",
        "model": dg_model,
        "keywords_count": len(keywords),
        "message": "Connected to Deepgram STT stream"
    })

    print(f"[STT] Deepgram stream started for {username} / {session_id} using model {dg_model}")

    # Track per-speaker word counts (supplements DiarizationService).
    # NOTE: kept session-wide only for the informational "speakers_detected"
    # stat sent to the client — it is NOT used to decide whether to fire a
    # warning (see BUG FIX note below).
    speaker_word_counts = {}

    MIN_WORDS_PER_SPEAKER = 2
    MULTI_SPEAKER_COOLDOWN_SEC = 5.0
    last_multi_speaker_alert_time = 0.0

    # Diagnostics: tells us whether audio reaches the backend / Deepgram answers
    stt_stats = {"chunks": 0, "bytes": 0, "dg_msgs": 0}

    async def stt_stats_logger():
        try:
            while True:
                await asyncio.sleep(5)
                print(
                    f"[STT][diag] {username}: audio chunks from browser={stt_stats['chunks']} "
                    f"({stt_stats['bytes'] // 1024} KB) | Deepgram msgs={stt_stats['dg_msgs']} "
                    f"| dg_closed={dg_ws.closed}"
                )
        except asyncio.CancelledError:
            pass

    async def client_to_deepgram():
        """Forward PCM & KeepAlive from browser → Deepgram without disconnecting."""
        try:
            while True:
                message = await websocket.receive()
                if message.get("type") == "websocket.disconnect":
                    break
                
                text_data = message.get("text")
                if text_data:
                    try:
                        data = json.loads(text_data)
                        msg_type = data.get("type")
                        if msg_type == "ping":
                            await websocket.send_json({"type": "pong"})
                        elif msg_type in ("KeepAlive", "keepalive"):
                            # Send KeepAlive JSON to Deepgram to prevent timeout during mic mute
                            if dg_ws and not dg_ws.closed:
                                await dg_ws.send_json({"type": "KeepAlive"})
                        elif msg_type == "Settings":
                            print(f"[STT] Client settings handshake received: {data.get('model', dg_model)}")
                    except Exception as err:
                        print(f"[STT] Error handling control text: {err}")
                    continue

                bytes_data = message.get("bytes")
                if bytes_data and dg_ws and not dg_ws.closed:
                    if STT_DIAG and stt_stats["chunks"] == 0:
                        print(f"[STT][diag] first audio chunk from browser: {len(bytes_data)} bytes")
                    stt_stats["chunks"] += 1
                    stt_stats["bytes"] += len(bytes_data)
                    await dg_ws.send_bytes(bytes_data)
        except WebSocketDisconnect:
            pass
        except Exception as e:
            print(f"[STT] client_to_deepgram error: {e}")
        finally:
            try: await dg_ws.close()
            except: pass

    async def deepgram_to_client():
        """Forward transcripts from Deepgram → browser + detect multi-speaker."""
        nonlocal last_multi_speaker_alert_time
        try:
            async for msg in dg_ws:
                if msg.type == aiohttp.WSMsgType.TEXT:
                    data = json.loads(msg.data)
                    stt_stats["dg_msgs"] += 1
                    print(f"[STT] Deepgram message: {data.get('type')}")

                    if data.get("type") == "Results":
                        channel = data.get("channel", {})
                        alternatives = channel.get("alternatives", [])
                        if not alternatives:
                            continue
                        alt = alternatives[0]
                        transcript = alt.get("transcript", "")
                        confidence = alt.get("confidence", 0.0)
                        words = alt.get("words", [])

                        # Session-wide tally — informational only, sent to
                        # client as "speakers_detected". Not used to trigger
                        # the warning below (see BUG FIX note above).
                        local_speaker_word_counts = {}
                        for w in words:
                            spk = w.get("speaker", 0)
                            speaker_word_counts[spk] = speaker_word_counts.get(spk, 0) + 1
                            local_speaker_word_counts[spk] = local_speaker_word_counts.get(spk, 0) + 1

                        is_final = data.get("is_final", False)
                        # speech_final = true only at a real utterance boundary
                        # (Deepgram detected a pause via utterance_end_ms/endpointing).
                        # is_final can fire on tiny mid-sentence fragments too, so
                        # speech_final is what the client should treat as "sentence
                        # complete" for reliable capitalization/full-stop handling.
                        speech_final = data.get("speech_final", False)

                        # Print returned transcript to terminal for easy debugging
                        if transcript and transcript.strip():
                            status = "SPEECH_FINAL" if speech_final else ("FINAL" if is_final else "INTERIM")
                            print(f"[DEEPGRAM STT ➔ CLIENT] [{status}] (conf: {confidence:.2f}): \"{transcript.strip()}\"")

                        # Send to client
                        await websocket.send_json({
                            "type": "transcript",
                            "transcript": transcript,
                            "is_final": is_final,
                            "speech_final": speech_final,
                            "confidence": confidence,
                            "speakers_detected": len(speaker_word_counts),
                        })

                        # Multi-speaker alert (supplements /ws/diarize) — only
                        # fires on real local evidence in THIS chunk, not on a
                        # permanently-stuck session flag, and respects a cooldown.
                        real_speakers_this_chunk = [
                            spk for spk, count in local_speaker_word_counts.items()
                            if count >= MIN_WORDS_PER_SPEAKER
                        ]
                        now = asyncio.get_event_loop().time()
                        in_cooldown = (now - last_multi_speaker_alert_time) < MULTI_SPEAKER_COOLDOWN_SEC

                        if is_final and len(real_speakers_this_chunk) >= 2 and not in_cooldown:
                            last_multi_speaker_alert_time = now
                            await websocket.send_json({
                                "type": "multi_speaker_warning",
                                "speakers": len(real_speakers_this_chunk),
                                "detail": f"Detected {len(real_speakers_this_chunk)} speakers in STT stream",
                            })

                    elif data.get("type") == "Metadata":
                        await websocket.send_json({"type": "connected", "model": dg_model})

                    elif data.get("type") == "UtteranceEnd":
                        # Deepgram detected a real pause (utterance_end_ms).
                        # This does NOT contain new words — it just tells us the
                        # last committed sentence is truly finished, so the client
                        # should close punctuation (add full stop, capitalize next).
                        await websocket.send_json({"type": "utterance_end"})

                elif msg.type in (aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.CLOSING,
                                  aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                    print(f"[STT] ❗ Deepgram socket ended: {msg.type.name} | "
                          f"close_code={dg_ws.close_code} | detail={msg.data!r} | exc={dg_ws.exception()}")
                    break
            print(f"[STT] deepgram_to_client loop exited | close_code={dg_ws.close_code}")
        except Exception as e:
            print(f"[STT] deepgram_to_client error: {e}")

    # Run both directions concurrently
    task1 = asyncio.create_task(client_to_deepgram())
    task2 = asyncio.create_task(deepgram_to_client())
    task3 = asyncio.create_task(stt_stats_logger()) if STT_DIAG else None

    try:
        done, pending = await asyncio.wait({task1, task2}, return_when=asyncio.FIRST_COMPLETED)
        for t in pending:
            t.cancel()
            try: await t
            except: pass
    except Exception as e:
        print(f"[STT] stream error: {e}")
    finally:
        if task3:
            task3.cancel()
        try: await dg_ws.close()
        except: pass
        try: await dg_session.close()
        except: pass
        try: await websocket.close()
        except: pass
        print(f"[STT] Deepgram stream closed for {username} / {session_id}")
