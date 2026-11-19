import secrets
import string
import time
from fastapi import APIRouter, HTTPException, Depends, Body
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from typing import Optional, List
from code.services.zoom_service import zoom_service
from code.services.zoom_bot_service import zoom_bot_service
from code.settings_route.routes import load_settings, save_settings
from code.services.email_service import send_zoom_schedule_email, send_google_meet_schedule_email, send_teams_schedule_email
from code.services.timetable_service import set_student_timetable
from code.services.exam_question_selector import select_exam_questions_for_student
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

class GoogleMeetScheduleRequest(BaseModel):
    username: str
    start_time: str
    end_time: str
    meeting_url: Optional[str] = None
    topics: Optional[List[str]] = []
    custom_message: Optional[str] = ""
    send_email: bool = True

class TeamsScheduleRequest(BaseModel):
    username: str
    start_time: str
    end_time: str
    meeting_url: Optional[str] = None
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
    """End or dismiss active meeting for student (also stops any active self-hosted bot)."""
    try:
        from code.self_hosted_bot.bridge import self_hosted_bot_bridge
        if self_hosted_bot_bridge.is_session_active(username):
            await self_hosted_bot_bridge.stop_session(username)
    except Exception:
        pass
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
                "meeting_url": meeting.get("join_url"),
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

        # 4. Save question set & prepare for On-Demand Bot Dispatch (bot joins only when student joins)
        questions = select_exam_questions_for_student(req.username, req.topics)
        db.active_meetings.update_one(
            {"candidate_username": req.username},
            {
                "$set": {
                    "provider": "zoom",
                    "meeting_url": meeting.get("join_url"),
                    "join_url": meeting.get("join_url"),
                    "meeting_id": meeting.get("meeting_id"),
                    "questions": questions,
                    "bot_status": "ready_to_dispatch",
                    "meeting_baas_bot_id": None,
                    "mb_status": None,
                    "mb_current_index": -1,
                    "mb_question_logs": []
                },
                "$unset": {
                    "teams_url": "",
                    "meet_url": ""
                }
            }
        )

        return {
            "success": True,
            "message": "Zoom interview successfully scheduled and invite sent",
            "meeting": meeting,
            "timetable": timetable,
            "email_sent": email_sent,
            "bot_status": "ready_to_dispatch"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to schedule Zoom interview: {str(e)}")


@router.get("/meet/config")
async def get_google_meet_config():
    """Check if Google Meet Enterprise REST API v2 auto-create is configured."""
    from code.services.google_meet_service import google_meet_service
    return {
        "auto_create_enabled": google_meet_service.is_configured(),
        "provider": "google_meet",
    }


@router.post("/meet/test")
async def test_google_meet_connection():
    """Verify Google Workspace Enterprise Meet REST API v2 credentials & OPEN space creation."""
    from code.services.google_meet_service import google_meet_service
    try:
        return await google_meet_service.test_connection()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Google Meet API verification failed: {str(e)}")


@router.post("/meet/schedule")
async def schedule_google_meet_interview(req: GoogleMeetScheduleRequest):
    """
    Schedule a Google Meet interview appointment for student:
    1. If meeting_url is omitted and Google Workspace Enterprise API is configured,
       auto-creates an OPEN Google Meet room (`accessType: OPEN`, zero knocking for @gmail.com students!).
       Otherwise validates the manually provided Google Meet room URL.
    2. Saves timetable slot in MongoDB with provider='google_meet'.
    3. Sends formatted Google Meet invite email with 1-Click Launcher.
    4. Prepares active meeting for On-Demand Interviewer dispatch.
    """
    try:
        from code.services.google_meet_service import google_meet_service

        user = db.users.find_one({"username": req.username}, {"_id": 0})
        if not user:
            raise HTTPException(status_code=404, detail=f"Student '{req.username}' not found")

        student_name = user.get("name", req.username)
        student_email = user.get("email")

        # 1. Auto-create OPEN Google Meet room via Workspace Enterprise API, or validate manual URL
        raw_url = (req.meeting_url or "").strip()
        access_type = "MANUAL"
        space_name = ""

        if not raw_url:
            if google_meet_service.is_configured():
                created = await google_meet_service.create_open_meeting(
                    topic=f"Technical Interview: {student_name}"
                )
                meet_url = created["meeting_url"]
                meeting_id = created["meeting_id"]
                access_type = created.get("access_type", "OPEN")
                space_name = created.get("space_name", "")
            else:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "Google Meet Enterprise Auto-Create is not configured yet (run google_meet_auth_setup.py), "
                        "OR paste a valid Google Meet URL (e.g. https://meet.google.com/abc-defg-hij)."
                    ),
                )
        else:
            if "meet.google.com" not in raw_url.lower():
                raise HTTPException(
                    status_code=400,
                    detail="A valid Google Meet URL is required (e.g. https://meet.google.com/abc-defg-hij).",
                )
            meet_url = raw_url if raw_url.startswith("http") else f"https://{raw_url}"
            base_meet = meet_url.split("?")[0].rstrip("/")
            meeting_id = base_meet.split("meet.google.com/")[-1].strip()
            meet_url = base_meet

        # 2. Lock Timetable slot in MongoDB
        timetable = set_student_timetable(
            username=req.username,
            start_time=req.start_time,
            end_time=req.end_time,
            topics=req.topics or [],
            student_email=student_email,
            student_name=student_name
        )

        db.timetables.update_one(
            {"username": req.username},
            {"$set": {
                "provider": "google_meet",
                "meeting_url": meet_url,
                "join_url": meet_url,
                "meet_url": meet_url,
                "meeting_id": meeting_id,
                "access_type": access_type,
            }}
        )

        # 3. Save question set & prepare active meeting (cleanly clearing any old Zoom/Teams fields)
        questions = select_exam_questions_for_student(req.username, req.topics)
        db.active_meetings.update_one(
            {"candidate_username": req.username},
            {
                "$set": {
                    "candidate_username": req.username,
                    "created_at": time.time(),
                    "provider": "google_meet",
                    "join_url": meet_url,
                    "meeting_url": meet_url,
                    "meet_url": meet_url,
                    "meeting_id": meeting_id,
                    "space_name": space_name,
                    "access_type": access_type,
                    "status": "active",
                    "topic": f"Technical Interview: {student_name}",
                    "questions": questions,
                    "bot_status": "ready_to_dispatch",
                    "bot_interview_id": None,
                    "self_hosted_session_id": None,
                    "shb_status": "ready_to_dispatch",
                    "shb_current_index": -1,
                    "meeting_baas_bot_id": None,
                    "mb_status": None,
                    "mb_current_index": -1,
                    "mb_question_logs": [],
                },
                "$unset": {
                    "host_url": "",
                    "host_app_url": "",
                    "app_url": "",
                    "participant_app_url": "",
                    "zoom_meeting_id": "",
                    "password": "",
                    "teams_url": "",
                },
            },
            upsert=True
        )

        # 4. Send Google Meet Invite Email (with 1-Click Launcher!)
        email_sent = False
        if req.send_email and student_email:
            email_sent = send_google_meet_schedule_email(
                to_email=student_email,
                name=student_name,
                username=req.username,
                start_time=req.start_time,
                end_time=req.end_time,
                meet_url=meet_url,
                topics=req.topics,
                custom_message=req.custom_message
            )

        meeting_info = {
            "provider": "google_meet",
            "meeting_id": meeting_id,
            "join_url": meet_url,
            "access_type": access_type,
            "auto_created": access_type == "OPEN",
            "topic": f"Technical Interview: {student_name}",
        }

        # 5. Option 2: On-Demand Bot Dispatch (bot joins only when student clicks launcher link)
        return {
            "success": True,
            "message": (
                "OPEN Google Meet room auto-created via Workspace API & invite sent"
                if access_type == "OPEN"
                else "Google Meet interview successfully scheduled and invite sent"
            ),
            "meeting": meeting_info,
            "timetable": timetable,
            "email_sent": email_sent,
            "bot_status": "ready_to_dispatch",
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to schedule Google Meet interview: {str(e)}")


@router.post("/teams/schedule")
async def schedule_teams_interview(req: TeamsScheduleRequest):
    """
    Schedule a Microsoft Teams interview appointment for student:
    1. Validates real Microsoft Teams meeting URL (teams.microsoft.com or teams.live.com).
    2. Saves timetable slot in MongoDB with provider: 'teams'.
    3. Sends formatted Microsoft Teams email invite to candidate.
    4. Prepares active meeting for On-Demand Bot Dispatch via Meeting BaaS.
    """
    try:
        user = db.users.find_one({"username": req.username}, {"_id": 0})
        if not user:
            raise HTTPException(status_code=404, detail=f"Student '{req.username}' not found")

        student_name = user.get("name", req.username)
        student_email = user.get("email")

        # 1. Validate Microsoft Teams room URL
        raw_url = (req.meeting_url or "").strip()
        if not raw_url or not any(x in raw_url.lower() for x in ("teams.microsoft.com", "teams.live.com")):
            raise HTTPException(
                status_code=400,
                detail="A valid Microsoft Teams URL is required (e.g. https://teams.microsoft.com/l/meetup-join/...). Please create a meeting in Teams and provide the link."
            )

        teams_url = raw_url
        if not teams_url.startswith("http"):
            teams_url = f"https://{teams_url}"

        # Extract meeting ID or slug if present
        meeting_id = "teams_meeting"
        try:
            if "meetup-join/" in teams_url:
                meeting_id = teams_url.split("meetup-join/")[1].split("/")[0].split("?")[0]
            elif "meet/" in teams_url:
                meeting_id = teams_url.split("meet/")[1].split("?")[0].strip("/")
            else:
                meeting_id = secrets.token_hex(6)
        except Exception:
            meeting_id = secrets.token_hex(6)

        # 2. Lock Timetable slot in MongoDB
        timetable = set_student_timetable(
            username=req.username,
            start_time=req.start_time,
            end_time=req.end_time,
            topics=req.topics or [],
            student_email=student_email,
            student_name=student_name
        )

        db.timetables.update_one(
            {"username": req.username},
            {"$set": {
                "provider": "teams",
                "meeting_url": teams_url,
                "join_url": teams_url,
                "teams_url": teams_url,
                "meeting_id": meeting_id
            }}
        )

        # 3. Save question set & prepare for On-Demand Bot Dispatch
        questions = select_exam_questions_for_student(req.username, req.topics)
        db.active_meetings.update_one(
            {"candidate_username": req.username},
            {
                "$set": {
                    "candidate_username": req.username,
                    "created_at": time.time(),
                    "provider": "teams",
                    "join_url": teams_url,
                    "meeting_url": teams_url,
                    "teams_url": teams_url,
                    "meeting_id": meeting_id,
                    "status": "active",
                    "topic": f"Technical Interview: {student_name}",
                    "questions": questions,
                    "bot_status": "ready_to_dispatch",
                    "meeting_baas_bot_id": None,
                    "mb_status": None,
                    "mb_current_index": -1,
                    "mb_question_logs": []
                },
                "$unset": {
                    "host_url": "",
                    "host_app_url": "",
                    "app_url": "",
                    "participant_app_url": "",
                    "zoom_meeting_id": "",
                    "password": ""
                }
            },
            upsert=True
        )

        # 4. Send Microsoft Teams Invite Email
        email_sent = False
        if req.send_email and student_email:
            email_sent = send_teams_schedule_email(
                to_email=student_email,
                name=student_name,
                username=req.username,
                start_time=req.start_time,
                end_time=req.end_time,
                teams_url=teams_url,
                topics=req.topics,
                custom_message=req.custom_message
            )

        meeting_info = {
            "provider": "teams",
            "meeting_id": meeting_id,
            "join_url": teams_url,
            "topic": f"Technical Interview: {student_name}"
        }

        # 5. Auto-dispatch the Self-Hosted Interviewer Bot immediately for Teams!
        bot_dispatched = False
        try:
            from code.self_hosted_bot.bridge import should_use_self_hosted
            if should_use_self_hosted():
                bot_meeting_url = await _resolve_bot_meeting_url({
                    "provider": "teams",
                    "teams_url": teams_url,
                    "join_url": teams_url,
                })
                asyncio.create_task(
                    zoom_bot_service.create_bot_interview(
                        username=req.username,
                        candidate_name=student_name,
                        meeting_url=bot_meeting_url,
                        questions=questions,
                        default_time_limit_sec=300,
                        provider_hint="teams",
                    )
                )
                bot_dispatched = True
                print(f"[ScheduleTeams] Auto-dispatched self-hosted bot for {req.username} at {teams_url}")
        except Exception as bot_err:
            print(f"[ScheduleTeams] Auto-dispatch notice: {bot_err}")

        return {
            "success": True,
            "message": "Microsoft Teams interview successfully scheduled and invite sent",
            "meeting": meeting_info,
            "timetable": timetable,
            "email_sent": email_sent,
            "bot_status": "dispatched" if bot_dispatched else "ready_to_dispatch"
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to schedule Microsoft Teams interview: {str(e)}")


class DispatchBotRequest(BaseModel):
    username: str


async def _resolve_bot_meeting_url(record: dict) -> str:
    """
    For Zoom + Self-Hosted Bot: returns a fresh Host Start URL (`.../s/{id}?zak={fresh_zak}`)
    so the Interviewer bot immediately starts the Zoom room as Host — eliminating 'Waiting for host'
    while the student joins cleanly with their own real display name!
    """
    from code.self_hosted_bot.bridge import should_use_self_hosted

    provider = record.get("provider", "zoom")
    join_url = record.get("join_url") or record.get("meeting_url") or record.get("teams_url") or ""

    if provider == "zoom" and should_use_self_hosted():
        meeting_id = record.get("meeting_id") or record.get("zoom_meeting_id")
        if meeting_id:
            fresh_start_url = await zoom_service.get_fresh_start_url(str(meeting_id))
            if fresh_start_url:
                return fresh_start_url
        if record.get("host_url"):
            return record["host_url"]
    return join_url


@router.post("/dispatch-bot")
async def dispatch_meeting_bot(req: DispatchBotRequest):
    """
    Dispatches the AI Interviewer bot on-demand when the student actually joins the meeting.
    Idempotent: if already deployed/in-call, returns current status without re-spawning.
    """
    record = db.active_meetings.find_one({"candidate_username": req.username})
    if not record:
        raise HTTPException(status_code=404, detail=f"No scheduled meeting found for '{req.username}'")

    # Check if already deployed and alive (self-hosted or Meeting BaaS)
    from code.self_hosted_bot.bridge import self_hosted_bot_bridge
    if self_hosted_bot_bridge.is_session_active(req.username):
        st = self_hosted_bot_bridge.get_status(req.username)
        return {"success": True, "message": "Self-hosted bot already active", "bot_session": st}

    mb_id = record.get("meeting_baas_bot_id")
    mb_status = record.get("mb_status")
    if mb_id and mb_status in ("deploying", "in_progress", "in_call"):
        try:
            from code.zoom_bot.meeting_baas import MeetingBaaSClient
            client = MeetingBaaSClient()
            b = await client.get_bot(mb_id)
            st = ((b.get("data") or {}).get("status") or "").lower()
            if "in_call" in st or "recording" in st or "joining" in st:
                return {"success": True, "message": "Bot already active", "bot_id": mb_id}
        except Exception:
            pass

    bot_meeting_url = await _resolve_bot_meeting_url(record)
    if not bot_meeting_url:
        raise HTTPException(status_code=400, detail="Meeting URL missing for this candidate")

    questions = record.get("questions") or select_exam_questions_for_student(req.username)
    user = db.users.find_one({"username": req.username}, {"_id": 0}) or {}
    student_name = user.get("name", req.username)

    bot_session = await zoom_bot_service.create_bot_interview(
        username=req.username,
        candidate_name=student_name,
        meeting_url=bot_meeting_url,
        questions=questions,
        default_time_limit_sec=300,
        provider_hint=record.get("provider"),
    )
    return {"success": True, "message": "Bot dispatched successfully", "bot_session": bot_session}


@router.get("/launch")
async def launch_meeting_from_email(username: str):
    """
    1-click meeting launcher from candidate email.
    Dispatches the AI Interviewer bot at the exact moment the student clicks,
    then instantly redirects the student's browser to the live meeting.
    """
    record = db.active_meetings.find_one({"candidate_username": username})
    if not record:
        raise HTTPException(status_code=404, detail="Meeting not found or schedule expired")

    user = db.users.find_one({"username": username}, {"_id": 0}) or {}
    student_display_name = (user.get("name") or username).strip()

    provider = record.get("provider", "zoom")
    if provider == "teams":
        meeting_url = record.get("teams_url") or record.get("join_url") or record.get("meeting_url")
    elif provider == "google_meet":
        meeting_url = record.get("meet_url") or record.get("join_url") or record.get("meeting_url")
    else:
        # Zoom: use participant join_url with student's real name (NOT host ZAK start_url)
        # so Zoom displays the student's own name (from Zoom login or uname) instead of the host account name!
        # Since meetings are created with join_before_host=True & waiting_room=False, student enters immediately.
        from urllib.parse import quote
        base_join = record.get("join_url") or record.get("meeting_url") or ""
        if base_join:
            sep = "&" if "?" in base_join else "?"
            meeting_url = f"{base_join}{sep}uname={quote(student_display_name)}" if "uname=" not in base_join else base_join
        else:
            meeting_url = record.get("host_url") or record.get("host_app_url")
    if not meeting_url:
        raise HTTPException(status_code=400, detail="Meeting join URL not found")

    # Dispatch bot on-demand if not already running
    try:
        from code.self_hosted_bot.bridge import self_hosted_bot_bridge
        mb_id = record.get("meeting_baas_bot_id")
        mb_status = record.get("mb_status")
        already_running = self_hosted_bot_bridge.is_session_active(username) or (
            mb_id and mb_status in ("deploying", "in_progress", "in_call")
        )
        if not already_running:
            questions = record.get("questions") or select_exam_questions_for_student(username)
            bot_meeting_url = await _resolve_bot_meeting_url(record)
            await zoom_bot_service.create_bot_interview(
                username=username,
                candidate_name=student_display_name,
                meeting_url=bot_meeting_url,
                questions=questions,
                default_time_limit_sec=300,
                provider_hint=provider,
            )
    except Exception as e:
        print(f"[MeetingLaunch] On-demand dispatch warning: {e}")

    return RedirectResponse(url=meeting_url)


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
    """Admin live status poll for candidate taking Zoom/Meet/Teams Bot interview."""
    from code.self_hosted_bot.bridge import self_hosted_bot_bridge
    shb_status = self_hosted_bot_bridge.get_status(username)
    if shb_status:
        return {"live": bool(shb_status.get("live")), "data": shb_status}

    active = db.active_meetings.find_one({"candidate_username": username})
    if not active or not active.get("bot_interview_id"):
        return {"live": False, "message": "No active bot interview"}
    bot_id = active.get("bot_interview_id")
    status = await zoom_bot_service.get_bot_interview_status(bot_id)
    return {"live": bool(status and status.get("live")), "data": status}


@router.get("/self-hosted-bot/status")
async def get_self_hosted_bot_overview():
    """Overview of 100% Free Self-Hosted Bot mode and active sessions."""
    from code.self_hosted_bot.bridge import self_hosted_bot_bridge, should_use_self_hosted
    return {
        "enabled": should_use_self_hosted(),
        "active_sessions": self_hosted_bot_bridge.list_active_sessions(),
    }


@router.post("/self-hosted-bot/stop/{username}")
async def stop_self_hosted_bot_session(username: str):
    """Gracefully stop an active self-hosted bot session for a candidate."""
    from code.self_hosted_bot.bridge import self_hosted_bot_bridge
    stopped = await self_hosted_bot_bridge.stop_session(username)
    return {"success": stopped, "username": username}


