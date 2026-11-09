from fastapi import APIRouter, HTTPException, Depends, Body
from pydantic import BaseModel
from typing import Optional, List
from code.services.zoom_service import zoom_service
from code.services.zoom_bot_service import zoom_bot_service
from code.settings_route.routes import load_settings, save_settings
from code.services.email_service import send_zoom_schedule_email
from code.services.timetable_service import set_student_timetable
from code.core.data_manager import db

router = APIRouter()

class ZoomTestRequest(BaseModel):
    account_id: str
    client_id: str
    client_secret: str

class ZoomCreateRequest(BaseModel):
    candidate_username: str
    topic: Optional[str] = None
    duration_minutes: Optional[int] = 60

class ZoomSessionTokenRequest(BaseModel):
    user_identity: str
    session_name: Optional[str] = None
    role: Optional[int] = 0
    session_key: Optional[str] = ""

class ZoomSignatureRequest(BaseModel):
    meeting_number: str
    role: Optional[int] = 0

class ZoomScheduleRequest(BaseModel):
    username: str
    start_time: str
    end_time: str
    topics: Optional[List[str]] = []
    custom_message: Optional[str] = ""
    send_email: bool = True

@router.get("/zoom/config")
async def get_zoom_config():
    """Check availability of Zoom credentials."""
    creds = zoom_service.get_credentials()
    return {
        "has_video_sdk": bool(creds.get("video_sdk_key") and creds.get("video_sdk_secret")),
        "has_oauth": bool(creds.get("account_id") and creds.get("client_id") and creds.get("client_secret")),
        "has_jwt": bool(creds.get("video_sdk_secret"))
    }

@router.post("/zoom/session-token")
async def get_zoom_session_token(req: ZoomSessionTokenRequest):
    """
    Generate Zoom Video SDK session token.
    role: 0 for candidate silent background participant, 1 for admin proctor.
    """
    try:
        session_name = req.session_name or f"exam_{req.user_identity.strip().lower()}"
        res = zoom_service.generate_video_sdk_token(
            session_name=session_name,
            user_identity=req.user_identity.strip(),
            role=req.role if req.role in (0, 1) else 0,
            session_key=req.session_key or ""
        )
        return {"success": True, **res}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Token generation failed: {str(e)}")

@router.post("/zoom/signature")
async def get_zoom_signature(req: ZoomSignatureRequest):
    """Generate signature for Zoom Web Meeting Client / Component."""
    try:
        res = zoom_service.generate_meeting_sdk_signature(
            meeting_number=req.meeting_number.strip(),
            role=req.role if req.role in (0, 1) else 0
        )
        return {"success": True, **res}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Signature generation failed: {str(e)}")

@router.post("/zoom/test")
async def test_zoom_credentials(req: ZoomTestRequest):
    """Admin tests Zoom Server-to-Server OAuth credentials."""
    try:
        result = await zoom_service.test_connection(
            account_id=req.account_id.strip(),
            client_id=req.client_id.strip(),
            client_secret=req.client_secret.strip()
        )
        return {"success": True, "message": "Zoom connection successful", "details": result}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/zoom/save-credentials")
async def save_zoom_credentials(req: ZoomTestRequest):
    """Save verified Zoom credentials to system settings."""
    try:
        # Verify first
        await zoom_service.test_connection(
            account_id=req.account_id.strip(),
            client_id=req.client_id.strip(),
            client_secret=req.client_secret.strip()
        )
        settings = load_settings()
        settings["zoom_account_id"] = req.account_id.strip()
        settings["zoom_client_id"] = req.client_id.strip()
        settings["zoom_client_secret"] = req.client_secret.strip()
        save_settings(settings)
        return {"success": True, "message": "Zoom credentials verified and saved successfully"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Verification failed: {str(e)}")

@router.post("/zoom/create")
async def create_zoom_meeting(req: ZoomCreateRequest):
    """
    Admin triggers instant Zoom meeting creation for a candidate.
    Returns meeting URLs and passcode.
    """
    try:
        topic = req.topic or f"Live Interview - {req.candidate_username}"
        meeting = await zoom_service.create_meeting(
            topic=topic,
            candidate_username=req.candidate_username,
            duration_minutes=req.duration_minutes or 60
        )
        return {"success": True, "meeting": meeting}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Zoom meeting creation failed: {str(e)}")

@router.get("/active/{username}")
async def get_active_meeting(username: str):
    """Candidate or Admin polls for active provisioned meeting."""
    meeting = zoom_service.get_active_meeting_for_candidate(username)
    if not meeting:
        return {"active": False, "meeting": None}
    return {"active": True, "meeting": meeting}

@router.post("/end/{username}")
async def end_active_meeting(username: str):
    """End or dismiss active meeting for student."""
    success = zoom_service.end_meeting_for_candidate(username)
    return {"success": success}

@router.post("/zoom/schedule")
async def schedule_zoom_interview(req: ZoomScheduleRequest):
    """
    Schedule a Zoom interview appointment for student:
    1. Provisions a Zoom Meeting with direct App launcher and Passcode.
    2. Saves timetable slot in MongoDB (restricting access to this window).
    3. Sends formatted Zoom email invite to candidate.
    """
    try:
        user = db.users.find_one({"username": req.username}, {"_id": 0})
        if not user:
            raise HTTPException(status_code=404, detail=f"Student '{req.username}' not found")

        student_name = user.get("name", req.username)
        student_email = user.get("email")

        # 1. Provision Zoom meeting as a Scheduled meeting (Type 2 with JBH=true)
        meeting = await zoom_service.create_meeting(
            topic=f"Technical Interview: {student_name}",
            candidate_username=req.username,
            duration_minutes=60,
            start_time=req.start_time
        )

        # 2. Lock Timetable slot in MongoDB
        timetable = set_student_timetable(
            username=req.username,
            start_time=req.start_time,
            end_time=req.end_time,
            topics=req.topics or [],
            student_email=student_email,
            student_name=student_name
        )

        # Link Zoom meeting ID and URLs in timetable record
        db.timetables.update_one(
            {"username": req.username},
            {"$set": {
                "provider": "zoom",
                "zoom_meeting_id": meeting.get("meeting_id"),
                "zoom_app_url": meeting.get("app_url"),
                "zoom_join_url": meeting.get("join_url"),
                "zoom_host_url": meeting.get("host_url"),
                "zoom_passcode": meeting.get("password")
            }}
        )

        # 3. Send Zoom Invite Email
        email_sent = False
        if req.send_email and student_email:
            email_sent = send_zoom_schedule_email(
                to_email=student_email,
                name=student_name,
                username=req.username,
                start_time=req.start_time,
                end_time=req.end_time,
                zoom_join_url=meeting.get("join_url", ""),
                zoom_app_url=meeting.get("app_url", ""),
                meeting_id=meeting.get("meeting_id", ""),
                passcode=meeting.get("password", ""),
                zoom_host_url=meeting.get("host_url", ""),
                topics=req.topics,
                custom_message=req.custom_message
            )

        # 4. Auto-provision Zoom Interview Bot for this session
        bot_session = None
        try:
            questions = []
            if req.topics:
                q_docs = list(db.questions.find({"category": {"$in": req.topics}}, {"_id": 0, "question": 1}).limit(5))
                questions = [q["question"] for q in q_docs if "question" in q]
            if not questions:
                q_docs = list(db.questions.find({}, {"_id": 0, "question": 1}).limit(5))
                questions = [q["question"] for q in q_docs if "question" in q]

            bot_session = await zoom_bot_service.create_bot_interview(
                username=req.username,
                candidate_name=student_name,
                meeting_url=meeting.get("join_url", ""),
                questions=questions,
                default_time_limit_sec=300
            )
        except Exception as bot_err:
            print(f"[ZoomSchedule] Bot auto-register notice: {bot_err}")

        return {
            "success": True,
            "message": "Zoom interview successfully scheduled and invite sent",
            "meeting": meeting,
            "timetable": timetable,
            "email_sent": email_sent,
            "bot_session": bot_session
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to schedule Zoom interview: {str(e)}")


# ─────────────────────────────────────────────────────────────────
# ZOOM BOT INTEGRATION ENDPOINTS
# ─────────────────────────────────────────────────────────────────
@router.post("/zoom-bot/event")
async def on_zoom_bot_event(payload: dict = Body(...)):
    """Receives real-time streaming events from interview-zoom-bot."""
    await zoom_bot_service.handle_bot_event(payload)
    return {"ok": True}


@router.post("/zoom-bot/complete")
async def on_zoom_bot_complete(payload: dict = Body(...)):
    """Receives completed interview payload from interview-zoom-bot and triggers AI scoring."""
    await zoom_bot_service.handle_bot_completion(payload)
    return {"ok": True, "message": "Interview completion recorded and evaluation scheduled"}


@router.get("/zoom-bot/status/{username}")
async def get_candidate_bot_status(username: str):
    """Admin live status poll for candidate taking Zoom Bot interview."""
    active = db.active_meetings.find_one({"candidate_username": username})
    if not active or not active.get("bot_interview_id"):
        return {"live": False, "message": "No active bot interview"}
    bot_id = active.get("bot_interview_id")
    status = await zoom_bot_service.get_bot_interview_status(bot_id)
    return {"live": bool(status and status.get("live")), "data": status}


