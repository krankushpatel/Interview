import logging
import asyncio
from typing import List, Dict, Any, Optional
from code.core.data_manager import db
from code.services.live_tracking import (
    register_active_exam, update_exam_progress,
    update_exam_status, unregister_active_exam
)

log = logging.getLogger("zoom_bot_service")


class ZoomBotService:
    def __init__(self):
        pass

    def _get_engine(self):
        try:
            from code.zoom_bot.routes import engine, db as zoom_db
            return engine, zoom_db
        except Exception as e:
            log.warning(f"[ZoomBot] Failed to import in-memory engine: {e}")
            return None, None

    async def create_bot_interview(
        self,
        username: str,
        candidate_name: str,
        meeting_url: str,
        questions: List[Dict[str, Any]],
        default_time_limit_sec: int = 300
    ) -> Optional[Dict[str, Any]]:
        """
        Registers an interview in the unified Zoom Bot engine.
        Questions can be a list of strings or dicts with text and time_limit_sec.
        """
        payload_questions: List[tuple[str, Optional[int]]] = []
        for q in questions:
            if isinstance(q, str):
                payload_questions.append((q, default_time_limit_sec))
            elif isinstance(q, dict):
                text = q.get("question") or q.get("text") or ""
                limit = q.get("time_limit_sec") or q.get("timer_seconds") or default_time_limit_sec
                if text:
                    payload_questions.append((text, limit))

        if not payload_questions:
            payload_questions = [
                ("Please introduce yourself and your technical background.", 180),
                ("Explain the key differences between SQL and NoSQL databases.", 300),
                ("Describe a challenging technical problem you solved recently.", 300)
            ]

        engine, _ = self._get_engine()
        if engine:
            try:
                s = await engine.create(
                    candidate_name=candidate_name or username,
                    meeting_url=meeting_url,
                    questions=payload_questions,
                    time_limit_sec=default_time_limit_sec
                )
                bot_session = s.snapshot()
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

                # Deploy Meeting BaaS bot to real Zoom call if key is set
                import os
                mb_key = os.getenv("MEETING_BAAS_API_KEY", "").strip()
                if mb_key and meeting_url and meeting_url.startswith("http"):
                    try:
                        from code.zoom_bot.meeting_baas import MeetingBaaSClient
                        mb_client = MeetingBaaSClient(mb_key)
                        q_list_text = "\n".join([f"Q{i+1}: {q[0]}" for i, q in enumerate(payload_questions)])
                        entry_msg = (
                            f"👋 Welcome {candidate_name or username}! I am your AI Interviewer.\n\n"
                            f"📝 Your Questions:\n{q_list_text}\n\n"
                            f"Please speak your answers clearly into your Zoom microphone."
                        )
                        mb_res = await mb_client.create_bot(
                            meeting_url=meeting_url,
                            bot_name="Interviewer",
                            entry_message=entry_msg
                        )
                        mb_bot_id = mb_res.get("bot_id") or mb_res.get("id")
                        if mb_bot_id:
                            db.active_meetings.update_one(
                                {"candidate_username": username},
                                {"$set": {"meeting_baas_bot_id": mb_bot_id}}
                            )
                            log.info(f"[ZoomBot] Meeting BaaS bot deployed to Zoom: {mb_bot_id}")
                    except Exception as mb_err:
                        log.warning(f"[ZoomBot] Meeting BaaS deployment notice: {mb_err}")

                register_active_exam(username, f"zoom_bot_{bot_id}", len(payload_questions))
                log.info(f"[ZoomBot] In-memory registered bot interview {bot_id} for {username}")
                return bot_session
            except Exception as e:
                log.error(f"[ZoomBot] In-memory create failed: {e}")

        return None

    async def get_bot_interview_status(self, interview_id: str) -> Optional[Dict[str, Any]]:
        engine, zoom_db = self._get_engine()
        if engine:
            s = engine.sessions.get(interview_id)
            if s:
                return s.snapshot()
            if zoom_db:
                row = zoom_db.get_interview(interview_id)
                if row:
                    row["live"] = False
                    row["answers"] = zoom_db.get_answers(interview_id)
                    row["total_questions"] = len(row.get("questions", []))
                    return row
        return None

    async def get_all_active_bot_interviews(self) -> List[Dict[str, Any]]:
        engine, _ = self._get_engine()
        if engine:
            return [s.snapshot() for s in engine.sessions.values()]
        return []

    async def handle_bot_event(self, data: Dict[str, Any]):
        """Real-time event bridge to Admin live tracking."""
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
            db.session_logs.insert_one({
                "username": username,
                "event_type": "inactivity_warning",
                "detail": f"Silence of {ev.get('silence_sec')}s on Question {ev.get('q_index', 0) + 1}",
                "timestamp": asyncio.get_event_loop().time()
            })
        elif ev_type == "completed":
            update_exam_status(username, "completed")

    async def handle_meeting_baas_event(self, event_type: str, data: Dict[str, Any]):
        """Handle status and transcript webhooks from Meeting BaaS."""
        bot_id = data.get("bot_id")
        record = db.active_meetings.find_one({"meeting_baas_bot_id": bot_id}) or \
                 db.active_meetings.find_one({"bot_interview_id": bot_id})
        username = record.get("candidate_username") or "Candidate" if record else "Candidate"

        if event_type == "bot.status_change":
            status_code = (data.get("status") or {}).get("code")
            if status_code == "in_call":
                update_exam_status(username, "active")
            elif status_code == "call_ended":
                update_exam_status(username, "completed")
                # Trigger transcript extraction
                asyncio.create_task(self._process_meeting_baas_transcript(bot_id, username))

        elif event_type == "complete":
            update_exam_status(username, "completed")
            asyncio.create_task(self._process_meeting_baas_transcript(bot_id, username))

    async def _process_meeting_baas_transcript(self, bot_id: str, username: str):
        """Fetch transcript from Meeting BaaS, save answers and trigger evaluation."""
        import os
        mb_key = os.getenv("MEETING_BAAS_API_KEY", "").strip()
        if not mb_key:
            return
        try:
            from code.zoom_bot.meeting_baas import MeetingBaaSClient
            client = MeetingBaaSClient(mb_key)
            meeting_data = await client.get_meeting_data(bot_id)
            transcripts = (meeting_data.get("data") or {}).get("transcripts") or []
            
            # Format combined transcript as answer
            combined_text = " ".join([t.get("words", "") or t.get("text", "") for t in transcripts]).strip()
            session_id = f"mb_{bot_id}"
            
            formatted_answers = [{
                "question_id": "0",
                "question": "Candidate Zoom Spoken Responses",
                "answer": combined_text or "Spoken response recorded in Zoom.",
                "status": "submitted",
                "duration_sec": 300,
                "word_count": len(combined_text.split())
            }]

            db.submissions.update_one(
                {"session_id": session_id},
                {"$set": {
                    "username": username,
                    "candidate_name": username,
                    "session_id": session_id,
                    "provider": "meeting_baas",
                    "answers": formatted_answers,
                    "total_questions": 1,
                    "status": "completed"
                }},
                upsert=True
            )

            # Trigger AI Evaluation
            from code.evaluation.routes import _run_final_evaluation
            asyncio.create_task(_run_final_evaluation(
                username=username,
                answers=formatted_answers,
                events=[],
                session_id=session_id
            ))
            log.info(f"[MeetingBaaS] Evaluation started for {username} via Meeting BaaS transcript.")
        except Exception as e:
            log.error(f"[MeetingBaaS] Error processing transcript for {bot_id}: {e}")

    async def handle_bot_completion(self, completion_data: Dict[str, Any]):
        """
        When bot finishes interview, transfer answers to MongoDB and run evaluation pipeline.
        """
        interview_id = completion_data.get("interview_id")
        candidate_name = completion_data.get("candidate_name", "Candidate")
        answers = completion_data.get("answers", [])

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

        unregister_active_exam(username)

        # Trigger AI evaluation pipeline
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
