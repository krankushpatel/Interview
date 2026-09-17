from datetime import datetime
import random
import string
import re
import os
from pathlib import Path
from code.config.settings import UPLOADS_DIR
from code.auth.password_utils import hash_password 
from code.core.data_manager import (
    load_users, save_users, get_loaded_data,
    save_submissions, save_exam_recordings, save_screen_recordings,
    save_session_logs, save_session_answers, save_session_proctoring,
    save_results_store, save_exam_sessions, get_db, db
)

def add_student(name: str, email: str, max_attempts: int = 1) -> dict: 
    """Add new student strictly to MongoDB"""
    db = get_db()
    
    # 🟢 STRICT FIX: Check if email already exists in the database
    if db.users.find_one({"email": {"$regex": f"^{re.escape(email)}$", "$options": "i"}}):
        return {
            "success": False,
            "message": f"Student with email '{email}' already exists!"
        }
    
    # Capitalize First letter of name and rest small (e.g., ankush kumar -> Ankush Kumar)
    name = name.strip().title()

    first_name = name.split()[0] if name.split() else "Student"
    
    base_username = first_name.capitalize().replace(".", "").replace("@", "")
    base_username = ''.join(c for c in base_username if c.isalnum())
    
    if not base_username:
        base_username = "Student"
        
    username = base_username
    counter = 1
    
    while db.users.find_one({"username": username}) or db.users.find_one({"_id": username}):
        username = f"{base_username}{counter}"
        counter += 1
        
    # plain_password = ''.join(random.choices(string.ascii_letters + string.digits, k=8))
    plain_password = username + "@" + "123"
    hashed_password = hash_password(plain_password)
    
    new_student = {
        "username": username,
        "password": hashed_password,
        "role": "student",
        "name": name,
        "email": email,
        "created_at": datetime.now().isoformat(),
        "attempts_taken": 0,
        "max_attempts": max_attempts,    
        "is_terminated": False,     
        "termination_reason": "", 
        "terminated_at": ""            
    }
    db.users.insert_one(new_student)
    
    return {
        "success": True,
        "username": username,
        "password": plain_password,
        "name": name,
        "email": email
    }

def get_students() -> dict:
    """Get all students from MongoDB"""
    db = get_db()
    students_cursor = db.users.find({"role": "student"})
    
    students = []
    for v in students_cursor:
        students.append({
            "username": v.get("username", ""),
            "name": v.get("name", v.get("username", "")),
            "email": v.get("email", ""),
            "attempts_taken": v.get("attempts_taken", 0),
            "max_attempts": v.get("max_attempts", 1),
            "is_terminated": v.get("is_terminated", False),
            "termination_reason": v.get("termination_reason", "")
        })
        
    return {
        "count": len(students),
        "students": students
    }

def delete_student(username: str) -> dict:
    """Delete student and all associated data including JSON memory and ALL MongoDB collections"""
    users = load_users()
    
    # 🟢 FIX: Remove strict check because user might exist in Mongo but not JSON
    if username in users and users[username].get("role") != "student":
        return {"success": False, "error": "Can only delete student accounts"}

    data = get_loaded_data()

    # 1. Delete physical video files
    for rec in data.get("exam_recordings", []) + data.get("screen_recordings", []):
        if rec.get("username") == username:
            file_path = UPLOADS_DIR / rec.get("video_file", "")
            if file_path.exists() and file_path.is_file():
                file_path.unlink()

    for sub in data.get("submissions", []):
        if sub.get("username") == username and sub.get("video_file"):
            file_path = UPLOADS_DIR / sub.get("video_file", "")
            if file_path.exists() and file_path.is_file():
                file_path.unlink()

    # 2. Clear memory data stores (Legacy JSON)
    data["submissions"] = [s for s in data.get("submissions", []) if s.get("username") != username]
    data["exam_recordings"] = [r for r in data.get("exam_recordings", []) if r.get("username") != username]
    data["screen_recordings"] = [s for s in data.get("screen_recordings", []) if s.get("username") != username]
    data["session_logs"] = [log for log in data.get("session_logs", []) if log.get("username") != username]

    if username in data.get("exam_sessions", {}):
        del data["exam_sessions"][username]
        save_exam_sessions()

    if username in data.get("session_answers", {}):
        del data["session_answers"][username]
    if username in data.get("session_proctoring", {}):
        del data["session_proctoring"][username]
    if username in data.get("results_store", {}):
        del data["results_store"][username]

    keys_to_delete = [k for k in data.get("results_store", {}).keys() if k.startswith(f"{username}_")]
    for k in keys_to_delete:
        del data["results_store"][k]

    save_submissions()
    save_exam_recordings()
    save_screen_recordings()
    save_session_logs()
    save_session_answers()
    save_session_proctoring()
    save_results_store()

    # 🟢 3. COMPLETE MONGODB CLEANUP: The Ultimate Fix
    try:
        # Wipe the user and EVERY possible data trace from MongoDB
        db.users.delete_one({"username": username})
        db.evaluations.delete_many({"username": username})
        db.submissions.delete_many({"username": username})
        db.timetables.delete_many({"username": username})
        db.session_logs.delete_many({"username": username})
        db.exam_sessions.delete_many({"username": username})
        db.session_answers.delete_many({"username": username})
        db.session_proctoring_logs.delete_many({"username": username})
        db.exam_recordings.delete_many({"username": username})
        db.screen_recordings.delete_many({"username": username})
        db.evidence_snapshots.delete_many({"username": username})
        db.eye_tracking.delete_many({"username": username})
        
    except Exception as e:
        print(f"[WARN] Failed to clean MongoDB collections for {username}: {e}")

    # 4. Delete user from JSON users store (if exists)
    if username in users:
        del users[username]
        save_users(users)

    return {"success": True, "message": f"Student {username} and all associated JSON/MongoDB data wiped out completely!"}

def get_student_submissions(username: str = None) -> dict:
    """Get submissions from MongoDB"""
    db = get_db()
    
    query = {}
    if username:
        query = {"username": username}
        
    subs_cursor = db.submissions.find(query).sort("submitted_at", -1)
    subs = list(subs_cursor)
    
    # Remove ObjectId for JSON serialization
    for s in subs:
        if "_id" in s:
            del s["_id"]
    
    # Calculate student stats
    students = {}
    for s in subs:
        u = s.get("username", "")
        if u not in students:
            students[u] = {"username": u, "count": 0, "has_video_count": 0}
        students[u]["count"] += 1
        if s.get("has_video"):
            students[u]["has_video_count"] += 1
    
    return {
        "total": len(subs),
        "students": list(students.values()),
        "submissions": subs
    }

def set_student_terminated(username: str, reason: str) -> bool:
    """Mark student as terminated in MongoDB"""
    db = get_db()
    result = db.users.update_one(
        {"username": username, "role": "student"},
        {"$set": {
            "is_terminated": True,
            "termination_reason": reason,
            "terminated_at": datetime.now().isoformat()
        }}
    )
    return result.modified_count > 0

def reset_student_termination(username: str) -> bool:
    """Reset termination status in MongoDB and sync memory"""
    db = get_db()
    
    # 1. Update User Status
    result = db.users.update_one(
        {"username": username, "role": "student"},
        {"$set": {
            "is_terminated": False,
            "termination_reason": "",
            "terminated_at": ""
        }}
    )
    
    if result.matched_count > 0:
        # 2. FIX: Delete using _id (because username is the _id in this collection)
        db.exam_sessions.delete_one({"_id": username})
        
        # 3. Sync Memory: Reload users and exam sessions so the cache is fresh
        from code.core.data_manager import load_users, load_exam_sessions
        load_users()
        load_exam_sessions()
        
        return True
    return False

def increase_attempts(username: str, increment_by: int = 1) -> dict:
    """Increase max attempts for student in MongoDB"""
    db = get_db()
    user = db.users.find_one({"username": username, "role": "student"})
    
    if not user:
        return {"success": False, "error": "Student not found"}
    
    current_max = user.get("max_attempts", 1)
    new_max = current_max + increment_by
    
    db.users.update_one(
        {"username": username},
        {"$set": {"max_attempts": new_max}}
    )
    
    return {"success": True, "new_max_attempts": new_max}

def set_student_categories(username: str, categories: list) -> dict:
    """Set preferred categories for student in MongoDB"""
    db = get_db()
    result = db.users.update_one(
        {"username": username, "role": "student"},
        {"$set": {"preferred_categories": categories}}
    )
    
    if result.matched_count == 0:
        return {"success": False, "error": "Student not found"}
        
    return {"success": True, "preferred_categories": categories}