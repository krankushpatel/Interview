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
    """Get all active exams"""
    return list(active_exams.values())

def get_active_exam(username: str) -> Dict[str, Any]:
    """Get specific active exam"""
    return active_exams.get(username, None)

def cleanup_idle_exams(timeout_minutes: int = 5):
    """Remove idle exams (no activity for X minutes)"""
    now = datetime.now()
    to_remove = []
    for username, data in active_exams.items():
        last_activity = datetime.fromisoformat(data["last_activity"])
        if (now - last_activity).total_seconds() > timeout_minutes * 60:
            to_remove.append(username)
    
    for username in to_remove:
        del active_exams[username]
        print(f"[LIVE] {username} removed due to idle timeout")