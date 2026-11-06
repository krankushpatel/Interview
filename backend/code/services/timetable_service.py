import os
from datetime import datetime
from typing import Optional, Dict, Any
import pytz
from code.core.data_manager import get_db, db

# India timezone
IST = pytz.timezone('Asia/Kolkata')
UTC = pytz.UTC

def get_student_timetable(username: str) -> Optional[Dict[str, Any]]:
    """Get timetable for a specific student from MongoDB"""
    db = get_db()
    timetable = db.timetables.find_one({"username": username})
    
    if timetable and "schedule" in timetable:
        if "_id" in timetable:
            timetable["_id"] = str(timetable["_id"])
        return timetable
    return None

def set_student_timetable(
    username: str, 
    start_time: str, 
    end_time: str, 
    topics: list,
    send_email_callback=None,
    student_email: str = None,
    student_name: str = None
) -> Dict[str, Any]:
    """Set or update timetable for a student directly in MongoDB"""
    db = get_db()
    
    # Parse ISO string and make it naive (remove existing tzinfo if present)
    dt_start = datetime.fromisoformat(start_time.replace('Z', '+00:00'))
    if dt_start.tzinfo is not None:
        dt_start = dt_start.astimezone(pytz.utc).replace(tzinfo=None)
    start_ist = IST.localize(dt_start)

    dt_end = datetime.fromisoformat(end_time.replace('Z', '+00:00'))
    if dt_end.tzinfo is not None:
        dt_end = dt_end.astimezone(pytz.utc).replace(tzinfo=None)
    end_ist = IST.localize(dt_end)
    
    # Convert to UTC for storage
    start_utc = start_ist.astimezone(UTC)
    end_utc = end_ist.astimezone(UTC)
    
    timetable_data = {
        "schedule": {
            "start_time": start_utc.isoformat(),
            "end_time": end_utc.isoformat(),
            "topics": topics,
            "is_active": True,
            "created_at": datetime.now(UTC).isoformat(),
            "updated_at": datetime.now(UTC).isoformat()
        }
    }
    
    # 🟢 Upsert directly into MongoDB (Update if exists, Insert if new)
    db.timetables.update_one(
        {"username": username},
        {"$set": timetable_data},
        upsert=True
    )
    
    # Send email notification if callback provided
    if send_email_callback and student_email and student_name:
        # 🟢 Updated format: Tuesday, 25 August 2026 at 04:35 PM
        start_display = start_ist.strftime('%A, %d %B %Y at %I:%M %p')
        end_display = end_ist.strftime('%A, %d %B %Y at %I:%M %p')
        send_email_callback(student_email, student_name, start_display, end_display, topics)
    
    return timetable_data

def delete_student_timetable(username: str) -> bool:
    """Delete timetable for a student from MongoDB"""
    db = get_db()
    result = db.timetables.delete_one({"username": username})
    return result.deleted_count > 0

def check_exam_eligibility(username: str) -> Dict[str, Any]:
    """Check if student can take exam based on timetable in MongoDB"""
    timetable = get_student_timetable(username)
    
    if not timetable:
        return {
            "has_schedule": False,
            "can_take_exam": False,
            "message": "No exam schedule assigned. Please contact your teacher.",
            "schedule": None
        }
    
    schedule = timetable.get("schedule", {})
    start_time_str = schedule.get("start_time")
    end_time_str = schedule.get("end_time")
    
    if not start_time_str or not end_time_str:
        return {
            "has_schedule": True,
            "can_take_exam": False,
            "message": "Exam schedule is incomplete. Please contact your teacher.",
            "schedule": schedule
        }
    
    # Parse UTC stored times
    start_utc = datetime.fromisoformat(start_time_str).replace(tzinfo=UTC)
    end_utc = datetime.fromisoformat(end_time_str).replace(tzinfo=UTC)
    
    # Convert to IST for display and comparison
    start_ist = start_utc.astimezone(IST)
    end_ist = end_utc.astimezone(IST)
    now_ist = datetime.now(IST)
    
    # Exam not started yet
    if now_ist < start_ist:
        time_diff = start_ist - now_ist
        hours = int(time_diff.total_seconds() // 3600)
        minutes = int((time_diff.total_seconds() % 3600) // 60)
        
        return {
            "has_schedule": True,
            "can_take_exam": False,
            "message": f"Exam has not started yet. Your exam will start on {start_ist.strftime('%d %b %Y, %I:%M %p')}",
            "schedule": schedule,
            "start_time": start_ist.isoformat(),
            "end_time": end_ist.isoformat(),
            "time_remaining": f"{hours}h {minutes}m",
            "time_remaining_seconds": time_diff.total_seconds(),
            "provider": timetable.get("provider", "webrtc"),
            "zoom_meeting_id": timetable.get("zoom_meeting_id"),
            "zoom_app_url": timetable.get("zoom_app_url"),
            "zoom_join_url": timetable.get("zoom_join_url"),
            "zoom_passcode": timetable.get("zoom_passcode")
        }
    
    # Exam already ended
    if now_ist > end_ist:
        return {
            "has_schedule": True,
            "can_take_exam": False,
            "message": f"Exam time has passed. Your exam ended on {end_ist.strftime('%d %b %Y, %I:%M %p')}",
            "schedule": schedule,
            "start_time": start_ist.isoformat(),
            "end_time": end_ist.isoformat(),
            "provider": timetable.get("provider", "webrtc"),
            "zoom_meeting_id": timetable.get("zoom_meeting_id"),
            "zoom_app_url": timetable.get("zoom_app_url"),
            "zoom_join_url": timetable.get("zoom_join_url"),
            "zoom_passcode": timetable.get("zoom_passcode")
        }
    
    # Exam is ongoing
    time_left = end_ist - now_ist
    hours = int(time_left.total_seconds() // 3600)
    minutes = int((time_left.total_seconds() % 3600) // 60)
    
    return {
        "has_schedule": True,
        "can_take_exam": True,
        "message": "You can take the exam now.",
        "schedule": schedule,
        "start_time": start_ist.isoformat(),
        "end_time": end_ist.isoformat(),
        "time_remaining": f"{hours}h {minutes}m",
        "time_remaining_seconds": time_left.total_seconds(),
        "provider": timetable.get("provider", "webrtc"),
        "zoom_meeting_id": timetable.get("zoom_meeting_id"),
        "zoom_app_url": timetable.get("zoom_app_url"),
        "zoom_join_url": timetable.get("zoom_join_url"),
        "zoom_passcode": timetable.get("zoom_passcode")
    }

def bulk_set_student_timetable(
    usernames: list,
    start_time: str,
    end_time: str,
    topics: list,
    send_email_callback=None,
    get_student_email=None,
    get_student_name=None
) -> Dict[str, Any]:
    """Set timetable for multiple students at once in MongoDB"""
    db = get_db()
    
    # Same safe timezone parsing applied here as well
    dt_start = datetime.fromisoformat(start_time.replace('Z', '+00:00'))
    if dt_start.tzinfo is not None:
        dt_start = dt_start.astimezone(pytz.utc).replace(tzinfo=None)
    start_local = IST.localize(dt_start)
    
    dt_end = datetime.fromisoformat(end_time.replace('Z', '+00:00'))
    if dt_end.tzinfo is not None:
        dt_end = dt_end.astimezone(pytz.utc).replace(tzinfo=None)
    end_local = IST.localize(dt_end)
    
    # Convert to UTC for storage
    start_utc = start_local.astimezone(UTC)
    end_utc = end_local.astimezone(UTC)
    
    success_count = 0
    failed_count = 0
    failed_list = []
    
    for username in usernames:
        try:
            timetable_data = {
                "schedule": {
                    "start_time": start_utc.isoformat(),
                    "end_time": end_utc.isoformat(),
                    "topics": topics,
                    "is_active": True,
                    "created_at": datetime.now(UTC).isoformat(),
                    "updated_at": datetime.now(UTC).isoformat()
                }
            }
            
            # 🟢 Upsert each user into MongoDB
            db.timetables.update_one(
                {"username": username},
                {"$set": timetable_data},
                upsert=True
            )
            success_count += 1
            
            # Send email notification if callback provided
            if send_email_callback and get_student_email and get_student_name:
                student_email = get_student_email(username)
                student_name = get_student_name(username)
                if student_email:
                    # 🟢 Updated format: Tuesday, 25 August 2026 at 04:35 PM
                    start_display = start_local.strftime('%A, %d %B %Y at %I:%M %p')
                    end_display = end_local.strftime('%A, %d %B %Y at %I:%M %p')
                    send_email_callback(student_email, student_name, start_display, end_display, topics)
                    
        except Exception as e:
            failed_count += 1
            failed_list.append({
                "username": username,
                "reason": str(e)
            })
    
    return {
        "success": True,
        "total": len(usernames),
        "success_count": success_count,
        "failed_count": failed_count,
        "failed_list": failed_list
    }