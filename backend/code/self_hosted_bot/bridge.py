"""Platform Bridge connecting the 100% Free Self-Hosted Bot to FastAPI, MongoDB, Live Tracking & Gemini Evaluation."""
from __future__ import annotations

import asyncio
import logging
import os
import sys
from datetime import datetime
from typing import Any, Dict, List, Optional, Sequence

from code.core.data_manager import db
from code.services.live_tracking import (
    register_active_exam,
    unregister_active_exam,
    update_exam_progress,
    update_exam_status,
)

from .config import load_bot_config
from .orchestrator import InterviewOrchestrator, InterviewResult, normalize_questions

log = logging.getLogger("self_hosted_bot.bridge")


def should_use_self_hosted() -> bool:
    """
    Decide whether to dispatch the 100% free Self-Hosted Bot or Meeting BaaS.
    Controlled by `BOT_PROVIDER` in backend/.env:
      - BOT_PROVIDER=self_hosted  -> always use Self-Hosted Bot ($0)
      - BOT_PROVIDER=meeting_baas -> always use Meeting BaaS
      - BOT_PROVIDER=auto (unset) -> use Self-Hosted if MEETING_BAAS_API_KEY is empty, else Meeting BaaS
    """
    mode = os.getenv("BOT_PROVIDER", "auto").strip().lower()
    if mode in ("self_hosted", "self-hosted", "local", "free"):
        return True
    if mode in ("meeting_baas", "meetingbaas"):
        return False
    mb_key = os.getenv("MEETING_BAAS_API_KEY", "").strip()
    return not bool(mb_key)


class SelfHostedBotBridge:
    """Singleton manager for active self-hosted bot sessions inside the FastAPI backend."""

    def __init__(self) -> None:
        self._orchestrators: Dict[str, InterviewOrchestrator] = {}
        self._tasks: Dict[str, asyncio.Task[InterviewResult]] = {}

    def is_session_active(self, username: str) -> bool:
        task = self._tasks.get(username)
        return bool(task and not task.done())

    def get_status(self, username: str) -> Optional[Dict[str, Any]]:
        orch = self._orchestrators.get(username)
        task = self._tasks.get(username)
        if not orch:
            return None
        worker = getattr(orch, "worker", None)
        screencast_task_st = str(getattr(worker, "_screencast_task", "NO_ATTR")) if worker else "NO_WORKER"
        from code.recording.screen_manager import screen_manager
        key = (username or "").strip().lower()
        return {
            "live": bool(task and not task.done()),
            "provider": "self_hosted",
            "session_id": orch.session_id,
            "platform": orch.platform,
            "status": orch.status,
            "q_index": orch.current_index,
            "total_questions": len(orch.questions),
            "candidate_name": orch.candidate_name,
            "screencast_active": getattr(worker, "_screencast_active", False) if worker else False,
            "screencast_task": screencast_task_st,
            "has_latest_camera_frame": key in screen_manager.latest_camera_frame,
            "camera_viewers_count": len(screen_manager.camera_viewers.get(key, [])),
        }

    def list_active_sessions(self) -> List[Dict[str, Any]]:
        out = []
        for username in list(self._orchestrators.keys()):
            st = self.get_status(username)
            if st and st.get("live"):
                out.append(st)
        return out

    async def launch_interview(
        self,
        *,
        username: str,
        candidate_name: str,
        meeting_url: str,
        questions: Sequence[Any],
        default_time_limit_sec: int = 300,
        provider_hint: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Idempotently spawn a Self-Hosted Bot interview in the background."""
        if self.is_session_active(username):
            existing = self.get_status(username)
            log.info("[SelfHostedBridge] Bot already active for %s (%s)", username, existing)
            return existing or {"live": True, "provider": "self_hosted", "username": username}

        try:
            from code.recording.screen_manager import screen_manager
            screen_manager._main_loop = asyncio.get_running_loop()
        except Exception:
            pass

        cfg = load_bot_config()
        cfg.default_time_limit_sec = default_time_limit_sec
        norm_qs = normalize_questions(questions, default_time_limit_sec)

        def _on_status(user: str, st: str) -> None:
            mapped = "active" if st == "in_progress" else st
            update_exam_status(user, mapped)
            try:
                db.active_meetings.update_one(
                    {"candidate_username": user},
                    {"$set": {"shb_status": st, "bot_status": st}},
                )
            except Exception:
                pass

        def _on_progress(user: str, q_idx: int, total: int, q_text: str) -> None:
            update_exam_progress(user, q_idx, q_idx, q_text)
            try:
                db.active_meetings.update_one(
                    {"candidate_username": user},
                    {"$set": {"shb_current_index": q_idx, "shb_status": "in_progress"}},
                )
            except Exception:
                pass
            try:
                from code.admin.ws_manager import admin_ws_manager
                from code.admin.monitoring import get_live_exams
                live_data = get_live_exams()
                from code.recording.screen_manager import screen_manager
                if getattr(screen_manager, "_main_loop", None) and screen_manager._main_loop.is_running():
                    asyncio.run_coroutine_threadsafe(
                        admin_ws_manager.broadcast_live_exams(live_data),
                        screen_manager._main_loop
                    )
            except Exception:
                pass

        orch = InterviewOrchestrator(
            username=username,
            candidate_name=candidate_name or username,
            meeting_url=meeting_url,
            questions=norm_qs,
            provider_hint=provider_hint,
            config=cfg,
            on_status=_on_status,
            on_progress=_on_progress,
            on_complete=None,  # Handled on Uvicorn's main event loop in _run_and_cleanup
        )

        # Register in Admin Live Tracking & MongoDB
        register_active_exam(username, orch.session_id, len(norm_qs))
        db.active_meetings.update_one(
            {"candidate_username": username},
            {
                "$set": {
                    "bot_provider": "self_hosted",
                    "bot_interview_id": orch.session_id,
                    "self_hosted_session_id": orch.session_id,
                    "bot_status": "launching",
                    "shb_status": "launching",
                    "shb_current_index": -1,
                }
            },
            upsert=True,
        )
        db.timetables.update_one(
            {"username": username},
            {"$set": {"bot_interview_id": orch.session_id}},
        )

        self._orchestrators[username] = orch
        task = asyncio.create_task(self._run_and_cleanup(username, orch))
        self._tasks[username] = task

        log.info(
            "[SelfHostedBridge] Dispatched self-hosted bot %s for %s -> %s",
            orch.session_id,
            username,
            meeting_url,
        )
        return {
            "id": orch.session_id,
            "session_id": orch.session_id,
            "provider": "self_hosted",
            "status": "launching",
            "total_questions": len(norm_qs),
            "live": True,
        }

    async def _run_and_cleanup(self, username: str, orch: InterviewOrchestrator) -> InterviewResult:
        def _thread_runner() -> InterviewResult:
            # On Windows, `uvicorn --reload` uses SelectorEventLoop which raises
            # NotImplementedError on `asyncio.create_subprocess_exec` (needed by Playwright).
            # Running each bot inside its own thread with ProactorEventLoop solves this permanently!
            if sys.platform == "win32":
                bot_loop = asyncio.ProactorEventLoop()
            else:
                bot_loop = asyncio.new_event_loop()
            asyncio.set_event_loop(bot_loop)
            setattr(orch, "_worker_loop", bot_loop)
            try:
                return bot_loop.run_until_complete(orch.run())
            finally:
                try:
                    bot_loop.close()
                except Exception:
                    pass

        try:
            result = await asyncio.to_thread(_thread_runner)
            if result.status not in ("failed", "no_show") and result.answers:
                await self._handle_completion(result)
            elif result.status == "no_show":
                db.active_meetings.update_one(
                    {"candidate_username": username},
                    {"$set": {"shb_status": "no_show", "bot_status": "no_show"}},
                )
            return result
        finally:
            unregister_active_exam(username)

    async def _handle_completion(self, result: InterviewResult) -> None:
        """Persist per-question transcripts into MongoDB `submissions` and trigger Gemini AI evaluation."""
        try:
            now_iso = datetime.now().isoformat()
            formatted_answers = result.to_formatted_answers()
            has_vid = bool(getattr(result, "video_file", None))

            db.submissions.delete_many({"session_id": result.session_id})
            for ans in formatted_answers:
                db.submissions.insert_one(
                    {
                        "username": result.username,
                        "candidate_name": result.candidate_name,
                        "session_id": result.session_id,
                        "provider": f"self_hosted_{result.platform}",
                        "question_id": ans["question_id"],
                        "question_text": ans["question_text"],
                        "question": ans["question"],
                        "answer": ans["answer"],
                        "category": ans["category"],
                        "status": ans["status"],
                        "duration_sec": ans["duration_sec"],
                        "word_count": ans["word_count"],
                        "audio_path": ans.get("audio_path"),
                        "submitted_at": now_iso,
                        "has_video": has_vid,
                    }
                )

            db.active_meetings.update_one(
                {"candidate_username": result.username},
                {
                    "$set": {
                        "shb_status": result.status,
                        "bot_status": result.status,
                        "shb_current_index": len(formatted_answers),
                    }
                },
            )
            update_exam_status(result.username, "completed")

            # -------------------------------------------------------------
            # Increment Candidate's Attempt Counter in MongoDB (Matches Portal Exam)
            # -------------------------------------------------------------
            db.users.update_one({"username": result.username}, {"$inc": {"attempts_taken": 1}})
            log.info("[SelfHostedBridge] Incremented attempts_taken for %s", result.username)

            # Check if candidate has attempts remaining (e.g. max_attempts=5)
            u = db.users.find_one({"username": result.username}, {"attempts_taken": 1, "max_attempts": 1}) or {}
            new_taken = u.get("attempts_taken", 1)
            user_max = u.get("max_attempts", 1)
            if new_taken < user_max:
                db.active_meetings.update_one(
                    {"candidate_username": result.username},
                    {
                        "$set": {
                            "bot_status": "ready_to_dispatch",
                            "shb_status": "ready_to_dispatch",
                            "bot_interview_id": None,
                            "self_hosted_session_id": None,
                            "shb_current_index": -1,
                        }
                    }
                )
                log.info(
                    "[SelfHostedBridge] Student %s has %d of %d attempts remaining. Meeting reset to ready_to_dispatch for next attempt.",
                    result.username,
                    user_max - new_taken,
                    user_max,
                )

            # -------------------------------------------------------------
            # Save Candidate Interview Video Recording to MongoDB & Memory
            # -------------------------------------------------------------
            if getattr(result, "video_file", None):
                try:
                    import time
                    from code.core.data_manager import get_loaded_data, save_exam_recordings
                    rec_ts = int(time.time() * 1000)
                    file_size_mb = 0.0
                    vid_path = getattr(result, "video_path", None)
                    if vid_path and os.path.exists(vid_path):
                        file_size_mb = round(os.path.getsize(vid_path) / (1024 * 1024), 2)

                    duration_sec = int(max(1, result.finished_at - result.started_at))
                    rec_doc = {
                        "id": str(rec_ts),
                        "username": result.username,
                        "session_id": result.session_id,
                        "video_file": result.video_file,
                        "duration_sec": duration_sec,
                        "size_mb": file_size_mb,
                        "submitted_at": datetime.now().isoformat(),
                    }
                    db.exam_recordings.insert_one(rec_doc)
                    db.submissions.update_many({"session_id": result.session_id}, {"$set": {"has_video": True}})
                    data = get_loaded_data()
                    data.setdefault("exam_recordings", []).append(rec_doc)
                    save_exam_recordings()
                    log.info(
                        "[SelfHostedBridge] Registered exam recording in MongoDB: %s (%.2f MB, %ds)",
                        result.video_file,
                        file_size_mb,
                        duration_sec,
                    )
                except Exception as rec_err:
                    log.warning("[SelfHostedBridge] Failed to register exam recording: %s", rec_err)

            log.info(
                "[SelfHostedBridge] Saved %d submissions for %s (session=%s). Triggering Gemini AI evaluation...",
                len(formatted_answers),
                result.username,
                result.session_id,
            )

            from code.evaluation.routes import _run_final_evaluation

            asyncio.create_task(
                _run_final_evaluation(
                    username=result.username,
                    answers=formatted_answers,
                    events=[],
                    session_id=result.session_id,
                )
            )
        except Exception as exc:
            log.error(
                "[SelfHostedBridge] Completion handoff error for %s: %s",
                result.username,
                exc,
                exc_info=True,
            )

    async def stop_session(self, username: str) -> bool:
        orch = self._orchestrators.get(username)
        task = self._tasks.get(username)
        if not orch or not task or task.done():
            return False
        orch.request_abort()
        try:
            await asyncio.wait_for(task, timeout=15.0)
        except Exception:
            task.cancel()
        return True

    async def stop_all(self) -> None:
        usernames = [u for u in list(self._tasks.keys()) if self.is_session_active(u)]
        if not usernames:
            return
        log.info("[SelfHostedBridge] Shutting down %d active self-hosted bot(s)...", len(usernames))
        await asyncio.gather(*(self.stop_session(u) for u in usernames), return_exceptions=True)


self_hosted_bot_bridge = SelfHostedBotBridge()
