from fastapi import APIRouter, HTTPException, Form, File, UploadFile
from code.student.exam_management import get_exam_status, start_exam, end_exam
from code.student.activity_logging import log_activity, get_session_logs
from code.core.data_manager import load_users
from code.legacy.external_services import check_exam_eligibility
from code.admin.students import set_student_terminated
from code.services.email_service import send_report_email
from code.admin.ws_manager import admin_ws_manager
from code.admin.monitoring import get_live_exams

router = APIRouter()

@router.get("/exam-status")
async def student_exam_status(username: str):
    """Check exam eligibility"""
    status = get_exam_status(username)
    if status is None:
        raise HTTPException(404, "Student not found")
    return status

@router.post("/start-exam")
async def student_start_exam(
    username: str = Form(...),
    session_id: str = Form(...),
    total_questions: int = Form(0)
):
    """Start exam session"""
    result = start_exam(username, session_id, total_questions)
    if not result["success"]:
        raise HTTPException(403, result.get("error", "Cannot start exam"))
    
    live_data = get_live_exams()
    await admin_ws_manager.broadcast_live_exams(live_data)
    
    return result

@router.post("/end-exam")
async def student_end_exam(
    username: str = Form(...),
    completed: bool = Form(False)
):
    """End exam session"""
    result = end_exam(username, completed)
    
    live_data = get_live_exams()
    await admin_ws_manager.broadcast_live_exams(live_data)
    
    return result

@router.post("/log-activity")
async def log_student_activity(
    username: str = Form(...),
    action: str = Form(...),
    details: str = Form(default=""),
    session_id: str = Form(None)
):
    """Log student activity"""
    log_activity(username, action, details, session_id)

@router.get("/attempt-status")
async def student_attempt_status(username: str):
    """Get student attempt information"""
    users = load_users()
    user = users.get(username)
    
    if not user or user.get("role") != "student":
        raise HTTPException(404, "Student not found")
    
    return {
        "attempts_taken": user.get("attempts_taken", 0),
        "max_attempts": user.get("max_attempts", 1),
        "preferred_categories": user.get("preferred_categories", []),
        "is_terminated": user.get("is_terminated", False),
        "termination_reason": user.get("termination_reason", "")
    }

@router.get("/exam-schedule/{username}")
async def student_exam_schedule(username: str):
    """Get exam schedule and eligibility for student"""
    result = check_exam_eligibility(username)
    
    if not result:
        raise HTTPException(404, "Student schedule data not found")
        
    return result

@router.post("/terminate") # Prefix '/student' main.py se apne aap lag jayega
async def student_self_terminate(
    username: str = Form(...),
    reason: str = Form("Violation Limit Exceeded")
):
    """Student ko cheating ki wajah se block karne ka rasta"""
    if set_student_terminated(username, reason):
        print(f"[TERMINATED] {username} for {reason}")
        return {"success": True, "message": "Exam terminated"}
    raise HTTPException(status_code=404, detail="Student not found")

@router.post("/send-report")
async def student_send_report(
    username: str = Form(...),
    pdf_report: UploadFile = File(...)
):
    """Send PDF report to student's email"""
    # 1. Load users to get the student's email
    users = load_users()
    user = users.get(username)
    
    if not user or user.get("role") != "student":
        raise HTTPException(status_code=404, detail="Student not found")
        
    student_email = user.get("email")
    student_name = user.get("name", username)
    
    if not student_email:
        raise HTTPException(status_code=400, detail="No registered email address found for this user")
        
    # 2. Read PDF bytes
    pdf_content = await pdf_report.read()
    
    # 3. Dispatch the email
    email_dispatched = send_report_email(
        to_email=student_email,
        name=student_name,
        pdf_bytes=pdf_content,
        filename=pdf_report.filename
    )
    
    if not email_dispatched:
        raise HTTPException(status_code=500, detail="Report downloaded but failed to send email.")
        
    return {"success": True, "message": "Report emailed successfully!"}