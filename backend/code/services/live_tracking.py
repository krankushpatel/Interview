import json
from datetime import datetime
from typing import Dict, Any
from pathlib import Path

# Active exams storage
active_exams: Dict[str, Dict[str, Any]] = {}

def register_active_exam(username: str, session_id: str, total_questions: int):
    """Register when student starts exam"""
    active_exams[username] = {
        "username": username,
        "session_id": session_id,
        "started_at": datetime.now().isoformat(),
        "last_activity": datetime.now().isoformat(),
        "total_questions": total_questions,
        "answered_count": 0,
        "current_question_index": 0,
        "current_question_text": "",
        "time_spent_seconds": 0,
        "status": "active"  # active, idle, terminated
    }
    print(f"[LIVE] {username} started exam")

def update_exam_progress(username: str, answered_count: int, current_index: int, current_text: str):
    """Update student's exam progress"""
    if username in active_exams:
        active_exams[username]["answered_count"] = answered_count
        active_exams[username]["current_question_index"] = current_index
        active_exams[username]["current_question_text"] = current_text[:50]
        active_exams[username]["last_activity"] = datetime.now().isoformat()
        # Calculate time spent
        started = datetime.fromisoformat(active_exams[username]["started_at"])
        active_exams[username]["time_spent_seconds"] = int((datetime.now() - started).total_seconds())

def update_exam_status(username: str, status: str):
    """Update student's exam status"""
    if username in active_exams:
        active_exams[username]["status"] = status

def unregister_active_exam(username: str):
    """Remove from active exams when exam ends"""
    if username in active_exams:
        del active_exams[username]
        print(f"[LIVE] {username} removed from active exams")

def get_active_exams() -> list:
    """Get all active exams, automatically reconciling with MongoDB active_meetings so sessions survive restarts/polling."""
    try:
        from code.core.data_manager import db
        import time
        now_ts = time.time()
        active_docs = list(db.active_meetings.find({"status": "active"}))
        for doc in active_docs:
            uname = doc.get("candidate_username")
            if not uname:
                continue
            created_at = doc.get("created_at")
            try:
                age_sec = now_ts - float(created_at) if created_at else 0
            except Exception:
                age_sec = 0
            # Only consider meetings active within last 2 hours
            if age_sec > 7200:
                continue

            if uname not in active_exams:
                started_dt = datetime.fromtimestamp(float(created_at)) if created_at else datetime.now()
                total_q = len(doc.get("questions") or []) or 10
                q_idx = int(doc.get("shb_current_index") if doc.get("shb_current_index") is not None else (doc.get("mb_current_index") or 0))
                qs = doc.get("questions") or []
                q_text = qs[q_idx] if 0 <= q_idx < len(qs) else ""

                active_exams[uname] = {
                    "username": uname,
                    "session_id": doc.get("self_hosted_session_id") or doc.get("bot_interview_id") or f"session_{uname}",
                    "started_at": started_dt.isoformat(),
                    "last_activity": datetime.now().isoformat(),
                    "total_questions": total_q,
                    "answered_count": max(0, q_idx),
                    "current_question_index": q_idx,
                    "current_question_text": q_text[:50],
                    "time_spent_seconds": int(age_sec),
                    "status": "active"
                }
    except Exception as exc:
        pass

    now = datetime.now()
    for username, data in active_exams.items():
        try:
            started = datetime.fromisoformat(data["started_at"])
            data["time_spent_seconds"] = max(0, int((now - started).total_seconds()))
        except Exception:
            pass

    return list(active_exams.values())

def get_active_exam(username: str) -> Dict[str, Any]:
    """Get specific active exam"""
    get_active_exams()
    return active_exams.get(username, None)

def cleanup_idle_exams(timeout_minutes: int = 60):
    """Remove idle exams (no activity for X minutes), but never remove active MongoDB meetings."""
    now = datetime.now()
    to_remove = []
    try:
        from code.core.data_manager import db
        import time
        now_ts = time.time()
        active_unames = set(
            doc.get("candidate_username")
            for doc in db.active_meetings.find({"status": "active"})
            if doc.get("created_at") and (now_ts - float(doc.get("created_at", 0))) < 7200
        )
    except Exception:
        active_unames = set()

    for username, data in active_exams.items():
        if username in active_unames:
            continue
        try:
            last_activity = datetime.fromisoformat(data["last_activity"])
            if (now - last_activity).total_seconds() > timeout_minutes * 60:
                to_remove.append(username)
        except Exception:
            pass
    
    for username in to_remove:
        del active_exams[username]
        print(f"[LIVE] {username} removed due to idle timeout")