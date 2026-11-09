import httpx
import logging
import asyncio
from typing import List, Dict, Any, Optional
from code.core.data_manager import db
from code.services.live_tracking import (
    register_active_exam, update_exam_progress,
    update_exam_status, unregister_active_exam
)

log = logging.getLogger("zoom_bot_service")

ZOOM_BOT_API_URL = "http://127.0.0.1:8000"

class ZoomBotService:
    def __init__(self, base_url: str = ZOOM_BOT_API_URL):
        self.base_url = base_url.rstrip("/")

    async def is_bot_service_available(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=3) as client:
                res = await client.get(f"{self.base_url}/api/health")
                return res.status_code == 200
        except Exception:
            return False

    async def create_bot_interview(
        self,
        username: str,
        candidate_name: str,
        meeting_url: str,
        questions: List[Dict[str, Any]],
        default_time_limit_sec: int = 300
    ) -> Optional[Dict[str, Any]]:
        """
        Registers an interview in the Zoom Bot service (interview-zoom-bot).
        Questions can be a list of strings or dicts with text and time_limit_sec.
        """
        payload_questions = []
        for q in questions:
            if isinstance(q, str):
                payload_questions.append({"text": q, "time_limit_sec": default_time_limit_sec})
            elif isinstance(q, dict):
                text = q.get("question") or q.get("text") or ""
                limit = q.get("time_limit_sec") or q.get("timer_seconds") or default_time_limit_sec
                if text:
                    payload_questions.append({"text": text, "time_limit_sec": limit})

        if not payload_questions:
            # Fallback default questions if student has none assigned
            payload_questions = [
                {"text": "Please introduce yourself and your background.", "time_limit_sec": 180},
                {"text": "Explain the key differences between SQL and NoSQL databases.", "time_limit_sec": 300},
                {"text": "Describe a challenging technical problem you solved recently.", "time_limit_sec": 300}
            ]

        body = {
            "candidate_name": candidate_name or username,
            "meeting_url": meeting_url,
            "questions": payload_questions,
            "time_limit_sec": default_time_limit_sec
        }

        try:
            async with httpx.AsyncClient(timeout=10) as client:
                res = await client.post(f"{self.base_url}/api/interviews", json=body)
                if res.status_code in (200, 201):
                    bot_session = res.json()
                    bot_id = bot_session.get("id")
                    # Link in Mongo active meetings & timetables
                    db.active_meetings.update_one(
                        {"candidate_username": username},
                        {"$set": {
                            "bot_interview_id": bot_id,
                            "bot_status": "created",
                            "bot_session": bot_session
                        }},
                        upsert=True
                    )
                    db.timetables.update_one(
                        {"username": username},
                        {"$set": {"bot_interview_id": bot_id}}
                    )
                    log.info(f"[ZoomBot] Registered bot interview {bot_id} for candidate {username}")
                    return bot_session
                else:
                    log.error(f"[ZoomBot] Failed to create bot interview: {res.status_code} - {res.text}")
                    return None
        except Exception as e:
            log.warning(f"[ZoomBot] Error connecting to zoom bot service: {e}")
            return None

    async def get_bot_interview_status(self, interview_id: str) -> Optional[Dict[str, Any]]:
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                res = await client.get(f"{self.base_url}/api/interviews/{interview_id}")
                if res.status_code == 200:
                    return res.json()
        except Exception as e:
            log.warning(f"[ZoomBot] Status check failed for {interview_id}: {e}")
        return None

    async def get_all_active_bot_interviews(self) -> List[Dict[str, Any]]:
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                res = await client.get(f"{self.base_url}/api/interviews")
                if res.status_code == 200:
                    return res.json()
        except Exception:
            pass
        return []

    async def handle_bot_event(self, data: Dict[str, Any]):
        """Real-time event bridge from interview-zoom-bot to main platform Admin live tracking."""
        interview_id = data.get("interview_id")
        candidate_name = data.get("candidate_name", "Candidate")
        ev = data.get("event", {})
        ev_type = ev.get("type", "")

        record = db.active_meetings.find_one({"bot_interview_id": interview_id}) or \
                 db.timetables.find_one({"bot_interview_id": interview_id})
        username = record.get("candidate_username") or record.get("username") if record else candidate_name

        if ev_type == "created":
            register_active_exam(username, f"zoom_bot_{interview_id}", 5)
        elif ev_type == "status" and ev.get("status") == "in_progress":
            update_exam_status(username, "active")
        elif ev_type == "question":
            q_idx = ev.get("q_index", 0)
            q_text = ev.get("text", "")
            update_exam_progress(username, q_idx, q_idx, q_text)
        elif ev_type == "answer_saved":
            q_idx = ev.get("q_index", 0)
            update_exam_progress(username, q_idx + 1, q_idx + 1, "")
        elif ev_type == "silence_detected":
            # Log in session logs for admin review
            db.session_logs.insert_one({
                "username": username,
                "event_type": "inactivity_warning",
                "detail": f"Silence of {ev.get('silence_sec')}s on Question {ev.get('q_index', 0) + 1}",
                "timestamp": asyncio.get_event_loop().time()
            })
        elif ev_type == "completed":
            update_exam_status(username, "completed")

    async def handle_bot_completion(self, completion_data: Dict[str, Any]):
        """
        When bot finishes interview, transfer answers to MongoDB and run evaluation pipeline.
        """
        interview_id = completion_data.get("interview_id")
        candidate_name = completion_data.get("candidate_name", "Candidate")
        answers = completion_data.get("answers", [])

        # Find matching username from active_meetings or timetables
        record = db.active_meetings.find_one({"bot_interview_id": interview_id}) or \
                 db.timetables.find_one({"bot_interview_id": interview_id})
        username = record.get("candidate_username") or record.get("username") if record else candidate_name

        session_id = f"zoom_bot_{interview_id}"
        formatted_answers = []
        for a in answers:
            formatted_answers.append({
                "question_id": str(a.get("q_index", 0)),
                "question": a.get("question", ""),
                "answer": a.get("answer", ""),
                "status": a.get("status", "submitted"),
                "duration_sec": a.get("duration_sec", 0),
                "word_count": a.get("word_count", 0)
            })

        # Save submission record in MongoDB
        db.submissions.update_one(
            {"session_id": session_id},
            {"$set": {
                "username": username,
                "candidate_name": candidate_name,
                "session_id": session_id,
                "provider": "zoom_bot",
                "answers": formatted_answers,
                "total_questions": len(formatted_answers),
                "status": "completed"
            }},
            upsert=True
        )

        # Trigger AI evaluation pipeline in background
        try:
            from code.evaluation.routes import _run_final_evaluation
            asyncio.create_task(_run_final_evaluation(
                username=username,
                answers=formatted_answers,
                events=[],
                session_id=session_id
            ))
            log.info(f"[ZoomBot] Evaluation pipeline triggered for {username} (session: {session_id})")
        except Exception as e:
            log.error(f"[ZoomBot] Failed to trigger final evaluation for {username}: {e}")

zoom_bot_service = ZoomBotService()
