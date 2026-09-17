from fastapi import APIRouter, HTTPException, Form
import json
from code.legacy.external_services import (
    set_student_timetable, get_student_timetable, delete_student_timetable,
    check_exam_eligibility, bulk_set_student_timetable,
    send_schedule_email
)
from code.core.data_manager import load_users

router = APIRouter()

# ✅ POST /admin/timetable/set (already correct)
@router.post("/set")
async def admin_set_timetable(
    username: str = Form(...),
    start_time: str = Form(...),
    end_time: str = Form(...),
    topics_json: str = Form(...)
):
    # ... (keep your existing implementation)
    users = load_users()
    if username not in users or users[username].get("role") != "student":
        raise HTTPException(404, "Student not found")
    
    try:
        topics = json.loads(topics_json)
        if not isinstance(topics, list):
            topics = []
    except:
        topics = []
    
    student_email = users[username].get("email")
    student_name = users[username].get("name")
    
    timetable = set_student_timetable(
        username, start_time, end_time, topics,
        send_email_callback=send_schedule_email if student_email else None,
        student_email=student_email,
        student_name=student_name
    )
    
    return {"success": True, "timetable": timetable}

# ✅ GET /admin/timetable/{username} (was /get/{username} before)
@router.get("/{username}")
async def admin_get_timetable(username: str):
    """Get timetable for student"""
    return get_student_timetable(username)

# ✅ DELETE /admin/timetable/{username} (was /delete/{username} before)
@router.delete("/{username}")
async def admin_delete_timetable(username: str):
    """Delete timetable for student"""
    deleted = delete_student_timetable(username)
    return {"success": deleted}

# ✅ Keep /student/schedule/{username} as is (called by students)
@router.get("/student/schedule/{username}")
async def student_exam_schedule(username: str):
    """Check exam eligibility and schedule"""
    users = load_users()
    if username not in users or users[username].get("role") != "student":
        raise HTTPException(404, "Student not found")
    return check_exam_eligibility(username)

# ✅ Bulk set endpoint (already correct)
@router.post("/bulk-set")
async def bulk_set_schedule(
    usernames_json: str = Form(...),
    start_time: str = Form(...),
    end_time: str = Form(...),
    topics_json: str = Form(...),
    send_email: bool = Form(True)
):
    try:
        usernames = json.loads(usernames_json)
        topics = json.loads(topics_json)
    except Exception as e:
        raise HTTPException(400, f"Invalid JSON data: {str(e)}")
    
    if not isinstance(usernames, list) or len(usernames) == 0:
        raise HTTPException(400, "No students selected")
    
    users = load_users()
    
    def get_student_email(username):
        return users.get(username, {}).get("email")
    
    def get_student_name(username):
        return users.get(username, {}).get("name", username)
    
    result = bulk_set_student_timetable(
        usernames=usernames,
        start_time=start_time,
        end_time=end_time,
        topics=topics,
        send_email_callback=send_schedule_email if send_email else None,
        get_student_email=get_student_email,
        get_student_name=get_student_name
    )
    
    return result