from fastapi import APIRouter, HTTPException, File, Form, UploadFile
from fastapi.responses import JSONResponse
from pathlib import Path
from datetime import datetime
import subprocess
import os
import pymongo
from code.config.settings import UPLOADS_DIR, WHISPER_AVAILABLE, _WHISPER_MODEL
from code.core.helpers import ts
from code.legacy.external_services import update_exam_progress
from code.core.data_manager import get_db, db
from code.evaluation.scoring_engine import clamp_answer_words

router = APIRouter()

@router.post("/submit")
async def submit_answer(
    answer: str = Form(...),
    username: str = Form(default="anonymous"),
    session_id: str = Form(...),
    question_id: int = Form(...),
    question_text: str = Form(default=""),
    question_category: str = Form(default="General"),
    answered_count: int = Form(0),
    current_index: int = Form(0),
    video: UploadFile = File(default=None),
):
    """Submit answer with optional video directly to MongoDB"""
    timestamp = ts()
    video_filename = None
    
    if video and video.filename:
        ext = Path(video.filename).suffix or ".webm"
        video_filename = f"video_{username}_{timestamp}{ext}"
        (UPLOADS_DIR / video_filename).write_bytes(await video.read())

    db = get_db()
    safe_answer = clamp_answer_words(answer)
    
    record = {
        "id": timestamp,
        "username": username,
        "session_id": session_id,
        "question_id": question_id,
        "question_text": question_text,
        "category": question_category,
        "answer": safe_answer,
        "video_file": video_filename,
        "has_video": video_filename is not None,
        "submitted_at": datetime.now().isoformat(),
    }
    
    # 🟢 Save directly to MongoDB with upsert to prevent duplicate submissions
    if session_id and question_id:
        db.submissions.update_one(
            {"username": username, "session_id": session_id, "question_id": question_id},
            {"$set": record},
            upsert=True
        )
    else:
        db.submissions.insert_one(record)

    update_exam_progress(username, answered_count, current_index, question_text)

    try:
        from code.admin.ws_manager import admin_ws_manager
        from code.admin.monitoring import get_live_exams
        live_data = get_live_exams()
        await admin_ws_manager.broadcast_live_exams(live_data)
    except Exception as ws_err:
        print(f"[LIVE WS] broadcast error on submit-answer: {ws_err}")

    return JSONResponse(content={
        "success": True,
        "submission_id": timestamp,
        "video_saved": video_filename is not None
    })

@router.post("/upload-answer")
async def upload_answer(
    username: str = Form(...),
    session_id: str = Form(default=""), # 🟢 Added Session ID explicitly
    question_id: int = Form(...),
    question_text: str = Form(default=""),
    category: str = Form(default="General"),
    transcript: str = Form(default=""),
    stt_engine: str = Form(default="unknown"),
    stt_confidence: float = Form(default=0.0),
    video: UploadFile = File(...),
):
    """Upload video answer with STT fallback chain to MongoDB"""
    timestamp = ts()
    ext = Path(video.filename).suffix or ".webm"
    video_filename = f"qa_{username}_q{question_id}_{timestamp}{ext}"
    video_path = UPLOADS_DIR / video_filename
    video_path.write_bytes(await video.read())

    final_transcript = transcript.strip() if transcript else ""
    stt_engine = stt_engine or "unknown"
    needs_human_review = False

    # STT Fallback logic (Exactly same as before)
    if not final_transcript:
        if WHISPER_AVAILABLE and _WHISPER_MODEL:
            wav_path = UPLOADS_DIR / f"audio_{timestamp}.wav"
            try:
                subprocess.run(
                    ["ffmpeg", "-y", "-i", str(video_path),
                     "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", str(wav_path)],
                    capture_output=True, timeout=60,
                )
                if wav_path.exists():
                    result = _WHISPER_MODEL.transcribe(str(wav_path), language=None)
                    final_transcript = result.get("text", "").strip()
                    wav_path.unlink(missing_ok=True)
                    stt_engine = "whisper_fallback"
                    if not final_transcript:
                        needs_human_review = True
                        stt_engine = "none"
            except Exception as e:
                print(f"[WARN] Whisper fallback transcription failed: {e}")
                needs_human_review = True
                stt_engine = "none"
        else:
            needs_human_review = True
            stt_engine = "none"
    else:
        if stt_engine == "deepgram" and stt_confidence < 0.6:
            needs_human_review = True

    db = get_db()
    
    # 🟢 Safety check: If frontend didn't send session_id, find the active one
    if not session_id:
        active_session = db.exam_sessions.find_one(
            {"username": username, "sessions.status": "started"},
            {"sessions": {"$elemMatch": {"status": "started"}}}
        )
        if active_session and active_session.get("sessions"):
            session_id = active_session["sessions"][0].get("session_id", "")

    record = {
        "id": timestamp,
        "username": username,
        "session_id": session_id,
        "question_id": question_id,
        "question_text": question_text,
        "category": category,
        "answer": final_transcript or "[No answer captured]",
        "video_file": video_filename,
        "has_video": True,
        "stt_engine": stt_engine,
        "stt_confidence": stt_confidence,
        "needs_human_review": needs_human_review,
        "submitted_at": datetime.now().isoformat(),
    }
    
    # 🟢 Save directly to MongoDB
    db.submissions.insert_one(record)

    return JSONResponse(content={
        "success": True,
        "transcript": final_transcript,
        "video_file": video_filename,
        "stt_engine": stt_engine,
        "stt_confidence": stt_confidence,
        "needs_human_review": needs_human_review,
    })