import os
from datetime import datetime, timedelta
from code.legacy.external_services import register_active_exam, unregister_active_exam
from code.core.data_manager import get_db, db

def start_exam(username: str, session_id: str, total_questions: int) -> dict:
    """Student starts exam - increment attempt counter directly in MongoDB"""
    user = db.users.find_one({"username": username, "role": "student"})
    
    if not user:
        return {"success": False, "error": "Student not found"}
    
    if user.get("is_terminated"):
        return {"success": False, "error": "Account terminated"}
    
    attempts_taken = user.get("attempts_taken", 0)
    max_attempts = user.get("max_attempts", 1)
    if attempts_taken >= max_attempts:
        return {"success": False, "error": f"All attempts used ({attempts_taken}/{max_attempts})"}
    
    # Increment attempt counter safely in DB
    db.users.update_one({"username": username}, {"$inc": {"attempts_taken": 1}})
    
    register_active_exam(username, session_id, total_questions)
    
    # 🟢 Record session directly in MongoDB collection
    session_data = {
        "session_id": session_id,
        "started_at": datetime.now().isoformat(),
        "status": "started",
        "total_questions": total_questions
    }
    db.exam_sessions.update_one(
        {"username": username},
        {"$push": {"sessions": session_data}},
        upsert=True
    )
    
    return {
        "success": True,
        "attempts_taken": attempts_taken + 1
    }

def end_exam(username: str, completed: bool = False) -> dict:
    """Student ends exam - Update status directly in MongoDB"""
    db = get_db()
    
    # 🟢 Find the specific active session and mark it completed
    db.exam_sessions.update_one(
        {"username": username, "sessions.status": "started"},
        {"$set": {
            "sessions.$.status": "completed" if completed else "abandoned",
            "sessions.$.ended_at": datetime.now().isoformat()
        }}
    )
    
    unregister_active_exam(username)
    return {"success": True}

def get_exam_status(username: str) -> dict:
    """Check if student can take exam and return dynamic settings from MongoDB"""
    db = get_db()
    user = db.users.find_one({"username": username, "role": "student"})
    
    if not user:
        return None
    
    attempts_taken = user.get("attempts_taken", 0)
    max_attempts = user.get("max_attempts", 1)
    is_terminated = user.get("is_terminated", False)
    termination_reason = user.get("termination_reason", "")
    
    can_take_exam = True
    reason = ""
    
    if is_terminated:
        can_take_exam = False
        reason = f"Account terminated: {termination_reason}"
    elif attempts_taken >= max_attempts:
        can_take_exam = False
        reason = f"All attempts used: {attempts_taken}/{max_attempts}. Ask teacher to increase limit."

    # ── 1. Load Global Settings as Default Fallback ──
    global_allow_typing = True
    
    active_settings = {
        "allowTyping": global_allow_typing,
        "totalQuestions": 10,
        "topicCounts": None 
    }

    # ── 2. Check Group/Batch Specific Override Settings in MongoDB ──
    # Find a batch where this student exists in the students array
    batch = db.batches.find_one({"students": username})
    
    if batch:
        batch_settings = batch.get("settings")
        if batch_settings:
            active_settings = {
                "allowTyping": batch_settings.get("allowTyping", global_allow_typing),
                "totalQuestions": batch_settings.get("totalQuestions", 10),
                "topicCounts": batch_settings.get("topicCounts", None),
                "topicDistribution": batch_settings.get("topicDistribution", None)
            }

    return {
        "attempts_taken": attempts_taken,
        "max_attempts": max_attempts,
        "is_terminated": is_terminated,
        "termination_reason": termination_reason,
        "can_take_exam": can_take_exam,
        "reason": reason,
        "settings": active_settings 
    }