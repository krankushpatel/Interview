"""
Zoom Bot Service — Autonomous Interview Controller via Meeting BaaS v2.

Architecture:
- On meeting schedule: deploys Meeting BaaS bot → starts autonomous controller task.
- Controller polls Meeting BaaS for new chat messages every few seconds.
- On detecting /submit, /skip, etc. from candidate → advances to next question.
- On timer expiry → auto-advances regardless.
- On server restart → startup hook resumes any active sessions from MongoDB.
- No external tunnel / webhook dependency for chat command detection.
"""
import logging
import asyncio
import time
from datetime import datetime
import os
from typing import List, Dict, Any, Optional

from code.core.data_manager import db
from code.services.live_tracking import (
    register_active_exam, update_exam_progress,
    update_exam_status, unregister_active_exam
)

log = logging.getLogger("zoom_bot_service")

# How often (seconds) to poll Meeting BaaS for bot status while waiting for join
_POLL_JOIN_INTERVAL = 4
# How often (seconds) to poll chat messages file / check for commands
_POLL_CHAT_INTERVAL = 5
# Sentinel: the bot sends messages under this name
_BOT_SENDER = "Interviewer"


class ZoomBotService:
    def __init__(self):
        # bot_id → asyncio.Task  (so we can cancel on shutdown or avoid duplicates)
        self._controller_tasks: Dict[str, asyncio.Task] = {}
        self._controller_events: Dict[str, asyncio.Event] = {}
        self._controller_commands: Dict[str, str] = {}
        self._processed_msg_ids: set = set()
        self._question_start_times: Dict[str, float] = {}
        self._bot_advance_locks: Dict[str, asyncio.Lock] = {}
        self._bot_last_advance: Dict[str, float] = {}

    # ------------------------------------------------------------------ helpers
    def _get_engine(self):
        try:
            from code.zoom_bot.routes import engine, db as zoom_db
            return engine, zoom_db
        except Exception as e:
            log.warning(f"[ZoomBot] Failed to import in-memory engine: {e}")
            return None, None

    def _mb_client(self):
        from code.zoom_bot.meeting_baas import MeetingBaaSClient
        return MeetingBaaSClient()

    # ======================================================================
    #  PUBLIC: create interview & deploy bot
    # ======================================================================
    async def create_bot_interview(
        self,
        username: str,
        candidate_name: str,
        meeting_url: str,
        questions: List[Dict[str, Any]],
        default_time_limit_sec: int = 300,
        provider_hint: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        # Check if 100% Free Self-Hosted Bot is enabled (BOT_PROVIDER=self_hosted or no Meeting BaaS key)
        try:
            from code.self_hosted_bot.bridge import self_hosted_bot_bridge, should_use_self_hosted
            if should_use_self_hosted() and meeting_url:
                log.info("[ZoomBot] Routing interview for %s to 100%% Free Self-Hosted Bot", username)
                return await self_hosted_bot_bridge.launch_interview(
                    username=username,
                    candidate_name=candidate_name or username,
                    meeting_url=meeting_url,
                    questions=questions,
                    default_time_limit_sec=default_time_limit_sec,
                    provider_hint=provider_hint,
                )
        except Exception as shb_err:
            log.error("[ZoomBot] Self-hosted bot launch error: %s", shb_err, exc_info=True)
            raise

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

                # Deploy Meeting BaaS bot
                mb_key = os.getenv("MEETING_BAAS_API_KEY", "").strip()
                if mb_key and meeting_url and meeting_url.startswith("http"):
                    try:
                        client = self._mb_client()
                        q_texts = [q[0] for q in payload_questions]
                        public_url = os.getenv("PUBLIC_BASE_URL", "").strip().rstrip("/")
                        webhook_url = f"{public_url}/zoom-bot/webhook/meeting-baas" if public_url else ""

                        entry_msg = f"👋 Welcome {candidate_name or username}! I am your AI Interviewer."
                        mb_res = await client.create_bot(
                            meeting_url=meeting_url,
                            bot_name="Interviewer",
                            entry_message=entry_msg,
                            webhook_url=webhook_url
                        )
                        mb_bot_id = (
                            mb_res.get("bot_id")
                            or (mb_res.get("data") or {}).get("bot_id")
                            or mb_res.get("id")
                        )
                        if mb_bot_id:
                            db.active_meetings.update_one(
                                {"candidate_username": username},
                                {"$set": {
                                    "meeting_baas_bot_id": mb_bot_id,
                                    "mb_questions": q_texts,
                                    "mb_current_index": -1,  # -1 = not started yet
                                    "mb_status": "deploying",
                                    "mb_last_chat_id": None,
                                }}
                            )
                            log.info("[ZoomBot] Meeting BaaS bot deployed: %s", mb_bot_id)
                            self._launch_controller(
                                bot_id=mb_bot_id,
                                username=username,
                                candidate_name=candidate_name or username,
                                questions=q_texts,
                                time_limit_sec=default_time_limit_sec,
                            )
                    except Exception as mb_err:
                        log.warning("[ZoomBot] Meeting BaaS deployment notice: %s", mb_err)

                register_active_exam(username, f"zoom_bot_{bot_id}", len(payload_questions))
                log.info("[ZoomBot] Registered bot interview %s for %s", bot_id, username)
                return bot_session
            except Exception as e:
                log.error("[ZoomBot] In-memory create failed: %s", e)

        return None

    # ======================================================================
    #  CONTROLLER: autonomous interview loop (polling, no webhook needed)
    # ======================================================================
    def _launch_controller(self, *, bot_id: str, username: str,
                           candidate_name: str, questions: List[str],
                           time_limit_sec: int, resume_index: int = -1):
        """Start the autonomous controller as an asyncio Task (idempotent)."""
        existing = self._controller_tasks.get(bot_id)
        if existing and not existing.done():
            log.info("[Controller] Already running for %s — skipping duplicate", bot_id)
            return
        if bot_id not in self._controller_events:
            self._controller_events[bot_id] = asyncio.Event()
        task = asyncio.create_task(
            self._controller_loop(
                bot_id=bot_id,
                username=username,
                candidate_name=candidate_name,
                questions=questions,
                time_limit_sec=time_limit_sec,
                resume_index=resume_index,
            )
        )
        self._controller_tasks[bot_id] = task

    async def _controller_loop(
        self, *,
        bot_id: str,
        username: str,
        candidate_name: str,
        questions: List[str],
        time_limit_sec: int,
        resume_index: int = -1,
    ):
        """Core autonomous loop. Posts questions, polls for /submit, auto-advances on timer."""
        client = self._mb_client()
        total = len(questions)
        log.info("[Controller] Started for %s (%d questions, resume=%d)", bot_id, total, resume_index)

        # ---- Phase 1: wait for bot to join the call ----
        if resume_index < 0:
            in_call = await self._wait_for_join(client, bot_id)
            if not in_call:
                log.warning("[Controller] Bot %s never joined — aborting", bot_id)
                self._controller_tasks.pop(bot_id, None)
                self._controller_events.pop(bot_id, None)
                self._controller_commands.pop(bot_id, None)
                return
            await asyncio.sleep(3)  # settle
            start_idx = 0
        else:
            start_idx = resume_index

        question_logs = []
        # ---- Phase 2: question loop ----
        for idx in range(start_idx, total):
            q_text = questions[idx]

            # Persist index
            db.active_meetings.update_one(
                {"meeting_baas_bot_id": bot_id},
                {"$set": {"mb_current_index": idx, "mb_status": "in_progress"}}
            )
            update_exam_progress(username, idx, idx, q_text)

            # Post question
            mins = max(1, time_limit_sec // 60)
            msg = (
                f"📝 Question {idx + 1} of {total}:\n\n"
                f"{q_text}\n\n"
                f"⏱️ You have {mins} min. Speak clearly into your microphone!\n"
                f"👉 Type '/submit' when done, or '/skip' to skip."
            )
            await client.send_chat_message(bot_id, msg)
            log.info("[Controller] Posted Q%d/%d to %s", idx + 1, total, bot_id)

            # Record question post time and clear any stale command/events
            self._question_start_times[bot_id] = time.time()
            self._controller_commands.pop(bot_id, None)
            if bot_id in self._controller_events:
                self._controller_events[bot_id].clear()

            # ---- wait for /submit OR timer ----
            command = await self._poll_for_command(
                client, bot_id, timeout_sec=time_limit_sec
            )

            # Check if bot is still alive
            alive = await self._is_bot_alive(client, bot_id)
            if not alive:
                log.warning("[Controller] Bot %s left/disconnected — stopping", bot_id)
                break

            if command == "/end":
                question_logs.append({"index": idx, "status": "ended", "command": command})
                await client.send_chat_message(bot_id, "⏹️ Interview ended. Generating evaluation...")
                break
            elif command == "/skip":
                question_logs.append({"index": idx, "status": "skipped", "command": command})
                await client.send_chat_message(bot_id, f"⏭️ Question {idx + 1} skipped!")
            elif command == "/submit":
                question_logs.append({"index": idx, "status": "submitted", "command": command})
                await client.send_chat_message(bot_id, f"✅ Question {idx + 1} answer recorded!")
            else:
                # timer expired
                question_logs.append({"index": idx, "status": "auto_submitted", "command": "timeout"})
                await client.send_chat_message(bot_id, f"⏳ Time's up for Question {idx + 1}! Moving on...")

            db.active_meetings.update_one(
                {"meeting_baas_bot_id": bot_id},
                {"$set": {"mb_question_logs": question_logs}}
            )
            await asyncio.sleep(2)

        # ---- Phase 3: wrap up ----
        final = (
            f"🎉 Congratulations {candidate_name}!\n"
            f"All questions completed. Thank you for your responses!\n\n"
            f"The bot is disconnecting and your AI evaluation report is being generated."
        )
        await client.send_chat_message(bot_id, final)
        await asyncio.sleep(3)
        await client.leave_bot(bot_id)

        db.active_meetings.update_one(
            {"meeting_baas_bot_id": bot_id},
            {"$set": {"mb_status": "completed", "mb_current_index": total}}
        )
        update_exam_status(username, "completed")
        self._controller_tasks.pop(bot_id, None)
        self._controller_events.pop(bot_id, None)
        self._controller_commands.pop(bot_id, None)

        # Fetch transcript & trigger evaluation
        await asyncio.sleep(8)
        await self._process_meeting_baas_transcript(bot_id, username)

    # ------------------------------------------------------------------ polling
    async def _wait_for_join(self, client, bot_id: str, max_wait: int = 120) -> bool:
        """Poll until bot status contains 'in_call' or 'recording'."""
        deadline = time.time() + max_wait
        while time.time() < deadline:
            try:
                b = await client.get_bot(bot_id)
                st = ((b.get("data") or {}).get("status") or "").lower()
                if "in_call" in st or "recording" in st:
                    log.info("[Controller] Bot %s is in call (status=%s)", bot_id, st)
                    return True
            except Exception as e:
                log.debug("[Controller] Poll error: %s", e)
            await asyncio.sleep(_POLL_JOIN_INTERVAL)
        return False

    async def _is_bot_alive(self, client, bot_id: str) -> bool:
        for attempt in range(2):
            try:
                b = await client.get_bot(bot_id)
                st = ((b.get("data") or {}).get("status") or "").lower()
                if not st:
                    return True
                if any(x in st for x in ("call_ended", "done", "failed")):
                    return False
                return True
            except Exception:
                await asyncio.sleep(1)
        return True

    async def _poll_for_command(
        self, client, bot_id: str, timeout_sec: int
    ) -> Optional[str]:
        """
        Poll Meeting BaaS for new chat messages. Return the first command found,
        or None when the timer expires.
        """
        event = self._controller_events.get(bot_id)
        if not event:
            event = asyncio.Event()
            self._controller_events[bot_id] = event
        event.clear()

        deadline = time.time() + timeout_sec
        q_start = self._question_start_times.get(bot_id, time.time())

        while time.time() < deadline:
            remaining = max(0.5, deadline - time.time())
            try:
                await asyncio.wait_for(event.wait(), timeout=min(_POLL_CHAT_INTERVAL, remaining))
                # Event was set by webhook handler
                cmd = self._controller_commands.pop(bot_id, None)
                event.clear()
                if cmd:
                    return cmd
            except asyncio.TimeoutError:
                # Active fallback: poll Meeting BaaS directly for /submit, /skip, /end
                try:
                    b = await client.get_bot(bot_id)
                    b_data = b.get("data") or {}
                    cm = b_data.get("chat_messages")
                    msgs = []
                    if isinstance(cm, list):
                        msgs = cm
                    elif isinstance(cm, str) and cm.startswith("http"):
                        async with httpx.AsyncClient(timeout=4.0) as http_c:
                            cm_resp = await http_c.get(cm)
                            if cm_resp.status_code == 200:
                                msgs = cm_resp.json()

                    for m in msgs:
                        m_id = m.get("message_id") or m.get("id") or ""
                        if not m_id or m_id in self._processed_msg_ids:
                            continue

                        # Skip bot's own questions
                        s_name = (m.get("sender_name") or m.get("sender") or "").lower()
                        if "interviewer" in s_name or m.get("sender_id") == 1:
                            continue

                        # Check message timestamp: must be after this question was posted
                        sent_at_str = m.get("sent_at") or m.get("created_at") or ""
                        if sent_at_str:
                            try:
                                from datetime import datetime, timezone
                                dt = datetime.fromisoformat(sent_at_str.replace("Z", "+00:00"))
                                if dt.timestamp() < q_start:
                                    continue
                            except Exception:
                                pass

                        m_text = (m.get("text") or m.get("message") or "").strip().lower()
                        clean_m = m_text.rstrip(".,! ")
                        detected_cmd = None
                        if clean_m in ("/submit", "submit") or clean_m.startswith("/submit"):
                            detected_cmd = "/submit"
                        elif clean_m in ("/skip", "skip") or clean_m.startswith("/skip"):
                            detected_cmd = "/skip"
                        elif clean_m in ("/end", "end") or clean_m.startswith("/end"):
                            detected_cmd = "/end"

                        if detected_cmd:
                            self._processed_msg_ids.add(m_id)
                            db.active_meetings.update_one({"meeting_baas_bot_id": bot_id}, {"$set": {"mb_last_chat_id": m_id}})
                            log.info("[Controller] ✅ Detected %s via chat poll for %s", detected_cmd, bot_id)
                            return detected_cmd
                except Exception as e:
                    log.debug("[Controller] Chat poll check notice: %s", e)

            # Optional: check if bot left unexpectedly
            try:
                alive = await self._is_bot_alive(client, bot_id)
                if not alive:
                    return "/end"
            except Exception:
                pass

        return None  # timer expired

    # ======================================================================
    #  WEBHOOK HANDLER (bonus — works when tunnel is alive)
    # ======================================================================
    async def handle_meeting_baas_event(self, event_type: str, data: Dict[str, Any]):
        """Called from /zoom-bot/webhook/meeting-baas."""
        bot_id = data.get("bot_id")
        if not bot_id:
            log.warning("[Webhook] No bot_id in event data: keys=%s", list(data.keys()))
            return

        record = db.active_meetings.find_one({"meeting_baas_bot_id": bot_id}) or \
                 db.active_meetings.find_one({"bot_interview_id": bot_id})
        username = record.get("candidate_username", "Candidate") if record else "Candidate"

        log.info("[Webhook] event=%s bot=%s user=%s", event_type, bot_id, username)

        if event_type == "bot.status_change":
            status_code = ""
            st = data.get("status")
            if isinstance(st, dict):
                status_code = st.get("code", "")
            elif isinstance(st, str):
                status_code = st
            log.info("[Webhook] Status change: %s", status_code)
            if status_code in ("in_call", "in_call_recording", "in_call_not_recording"):
                update_exam_status(username, "active")
            elif status_code in ("call_ended", "done"):
                update_exam_status(username, "completed")
                asyncio.create_task(self._process_meeting_baas_transcript(bot_id, username))

        elif event_type in ("bot.chat_message", "bot.chatmessage", "chat_message"):
            msg_id = data.get("message_id") or data.get("id") or ""
            if msg_id and msg_id in self._processed_msg_ids:
                log.info("[Webhook] Duplicate message_id '%s' ignored", msg_id)
                return
            if msg_id:
                self._processed_msg_ids.add(msg_id)
                if len(self._processed_msg_ids) > 1000:
                    self._processed_msg_ids.clear()

            # Meeting BaaS sends: data.sender, data.message (or data.text, data.sender_name)
            text = (data.get("message") or data.get("text") or "").strip().lower()
            sender = (data.get("sender") or data.get("sender_name") or "").strip()
            log.info("[Webhook] Chat from '%s': '%s' (all data keys: %s)", sender, text, list(data.keys()))

            # Don't react to our own bot's messages
            s_low = sender.lower()
            if "interviewer" in s_low or s_low == _BOT_SENDER.lower() or data.get("sender_id") == 1 or data.get("is_bot") or data.get("from_bot"):
                return

            # Signal the controller if it's waiting
            cmd = None
            clean_t = text.strip().lower().rstrip(".,! ")
            if clean_t in ("/submit", "/next", "submit", "next") or clean_t.startswith("/submit") or clean_t == "submit":
                cmd = "/submit"
            elif clean_t in ("/skip", "skip") or clean_t.startswith("/skip") or clean_t == "skip":
                cmd = "/skip"
            elif clean_t in ("/end", "end", "/exit", "exit") or clean_t.startswith("/end"):
                cmd = "/end"
            elif clean_t in ("/repeat", "repeat", "start", "/start", "hi", "hello", "ready") or clean_t.startswith("/repeat"):
                # Re-display question inline in chat
                if record:
                    idx = record.get("mb_current_index", 0)
                    qs = record.get("mb_questions", [])
                    if 0 <= idx < len(qs):
                        client = self._mb_client()
                        await client.send_chat_message(
                            bot_id,
                            f"📝 Question {idx+1} of {len(qs)}:\n\n{qs[idx]}\n\n⏱️ Speak into mic, then type '/submit' when done (or '/skip')."
                        )
                return

            if cmd:
                # Minimum 1.0 second elapsed since current question was posted
                q_start = self._question_start_times.get(bot_id, 0.0)
                now = time.time()
                if now - q_start < 1.0:
                    log.info("[Webhook] ⚠️ Ignored '%s' for bot %s: arrived only %.2fs after question posted (residual/duplicate)", cmd, bot_id, now - q_start)
                    return

                event_obj = self._controller_events.get(bot_id)
                ctrl_task = self._controller_tasks.get(bot_id)
                if event_obj and ctrl_task and not ctrl_task.done():
                    log.info("[Webhook] ✅ Signaled controller for bot %s with cmd: %s", bot_id, cmd)
                    self._controller_commands[bot_id] = cmd
                    event_obj.set()
                else:
                    # Controller not running — use DB fallback
                    log.info("[Webhook] No active controller for %s, using DB fallback", bot_id)
                    if cmd == "/submit":
                        asyncio.create_task(self._advance_via_db(bot_id, skip=False))
                    elif cmd == "/skip":
                        asyncio.create_task(self._advance_via_db(bot_id, skip=True))
                    elif cmd == "/end":
                        asyncio.create_task(self._end_via_db(bot_id))

        elif event_type in ("complete", "failed"):
            update_exam_status(username, "completed")
            asyncio.create_task(self._process_meeting_baas_transcript(bot_id, username))

    # ======================================================================
    #  DB-FALLBACK: advance without running controller
    # ======================================================================
    async def _advance_via_db(self, bot_id: str, skip: bool = False):
        if bot_id not in self._bot_advance_locks:
            self._bot_advance_locks[bot_id] = asyncio.Lock()

        async with self._bot_advance_locks[bot_id]:
            now = time.time()
            last_adv = self._bot_last_advance.get(bot_id, 0.0)
            if now - last_adv < 2.0:
                log.info("[DBAdvance] Ignored duplicate/burst advance for bot %s (%.2fs since last)", bot_id, now - last_adv)
                return
            self._bot_last_advance[bot_id] = now

            client = self._mb_client()
            record = db.active_meetings.find_one({"meeting_baas_bot_id": bot_id})
            if not record:
                return
            username = record.get("candidate_username", "Candidate")
            questions = record.get("mb_questions", [])
            curr_idx = record.get("mb_current_index", 0)
            next_idx = curr_idx + 1

            label = "Skipped" if skip else "Recorded & Submitted"
            q_logs = record.get("mb_question_logs", [])
            q_logs.append({"index": curr_idx, "status": "skipped" if skip else "submitted"})

            if next_idx < len(questions):
                db.active_meetings.update_one(
                    {"_id": record["_id"]},
                    {"$set": {"mb_current_index": next_idx, "mb_question_logs": q_logs}}
                )
                update_exam_progress(username, next_idx, next_idx, questions[next_idx])
                log.info("[DBAdvance] Candidate %s advanced to Q%d/%d", username, next_idx + 1, len(questions))

                # Send acknowledgment and next question to Zoom chat
                await client.send_chat_message(bot_id, f"✅ Question {curr_idx + 1} {label}!")
                msg = (
                    f"📝 Question {next_idx + 1} of {len(questions)}:\n\n"
                    f"{questions[next_idx]}\n\n"
                    f"⏱️ Speak clearly into your microphone!\n"
                    f"👉 Type '/submit' when done (or '/skip')."
                )
                await client.send_chat_message(bot_id, msg)
            else:
                db.active_meetings.update_one(
                    {"_id": record["_id"]},
                    {"$set": {"mb_current_index": next_idx, "mb_question_logs": q_logs, "mb_status": "completed"}}
                )
                update_exam_status(username, "completed")
                await client.send_chat_message(
                    bot_id,
                    f"🎉 All {len(questions)} questions completed! Generating evaluation..."
                )
                await asyncio.sleep(2)
                await client.leave_bot(bot_id)
                await asyncio.sleep(5)
                await self._process_meeting_baas_transcript(bot_id, username)

    async def _end_via_db(self, bot_id: str):
        client = self._mb_client()
        record = db.active_meetings.find_one({"meeting_baas_bot_id": bot_id})
        username = record.get("candidate_username", "Candidate") if record else "Candidate"
        await client.send_chat_message(bot_id, "⏹️ Interview ended. Generating evaluation...")
        await asyncio.sleep(2)
        await client.leave_bot(bot_id)
        update_exam_status(username, "completed")
        db.active_meetings.update_one(
            {"meeting_baas_bot_id": bot_id},
            {"$set": {"mb_status": "completed"}}
        )
        await asyncio.sleep(5)
        await self._process_meeting_baas_transcript(bot_id, username)

    # ======================================================================
    #  STARTUP RESUME: restart controllers for active sessions
    # ======================================================================
    async def resume_active_sessions(self):
        """Called on FastAPI startup — restarts controllers for in-progress interviews."""
        mb_key = os.getenv("MEETING_BAAS_API_KEY", "").strip()
        if not mb_key:
            return

        active = list(db.active_meetings.find({
            "meeting_baas_bot_id": {"$exists": True, "$ne": None},
            "mb_status": {"$nin": ["completed", None]}
        }))

        client = self._mb_client()
        for record in active:
            bot_id = record.get("meeting_baas_bot_id")
            username = record.get("candidate_username", "Candidate")
            questions = record.get("mb_questions", [])
            curr_idx = record.get("mb_current_index", 0)

            if not bot_id or not questions:
                continue

            # Check if bot is still in the call
            try:
                alive = await self._is_bot_alive(client, bot_id)
            except Exception:
                alive = False

            if alive:
                log.info("[Resume] Restarting controller for %s (Q%d/%d)", bot_id, curr_idx + 1, len(questions))
                self._launch_controller(
                    bot_id=bot_id,
                    username=username,
                    candidate_name=username,
                    questions=questions,
                    time_limit_sec=int(os.getenv("DEFAULT_TIME_LIMIT_SEC", "180")),
                    resume_index=curr_idx,
                )
            else:
                log.info("[Resume] Bot %s is no longer in call — marking completed", bot_id)
                db.active_meetings.update_one(
                    {"_id": record["_id"]},
                    {"$set": {"mb_status": "completed"}}
                )

    # ======================================================================
    #  TRANSCRIPT & EVALUATION
    # ======================================================================
    async def _process_meeting_baas_transcript(self, bot_id: str, username: str):
        mb_key = os.getenv("MEETING_BAAS_API_KEY", "").strip()
        if not mb_key:
            return
        try:
            client = self._mb_client()
            # Wait to ensure Meeting BaaS has finalized audio/video artifacts in S3
            await asyncio.sleep(12)

            bot_data = await client.get_bot(bot_id)
            inner = bot_data.get("data") or {}
            audio_url = inner.get("audio") or inner.get("video")

            record = db.active_meetings.find_one({"meeting_baas_bot_id": bot_id})
            questions = (record or {}).get("mb_questions", ["Interview Questions"])
            q_logs = (record or {}).get("mb_question_logs", [])
            q_status_map = {q.get("index"): q.get("status") for q in q_logs if isinstance(q, dict)}

            # Also check chat_messages artifact from Meeting BaaS if available to deduce skips
            chat_url = inner.get("chat_messages")
            if chat_url:
                try:
                    import httpx
                    async with httpx.AsyncClient(timeout=20) as http:
                        c_resp = await http.get(chat_url)
                        if c_resp.status_code == 200:
                            c_msgs = c_resp.json()
                            curr_q = -1
                            for m in c_msgs:
                                text = (m.get("text") or m.get("message") or "").strip().lower()
                                sender = (m.get("sender_name") or m.get("sender") or "").strip().lower()
                                if sender == "interviewer" and "question " in text:
                                    try:
                                        curr_q = int(text.split("question ")[1].split(" of")[0]) - 1
                                    except Exception:
                                        pass
                                elif sender != "interviewer" and curr_q >= 0:
                                    if text in ("/skip", "skip"):
                                        q_status_map[curr_q] = "skipped"
                                    elif text in ("/submit", "submit"):
                                        q_status_map[curr_q] = "submitted"
                except Exception as c_err:
                    log.warning("[Transcript] Error reading chat artifact: %s", c_err)

            # Transcribe audio using Deepgram Nova-3
            deepgram_key = os.getenv("DEEPGRAM_API_KEY", "").strip()
            speech_segments = []
            if audio_url and deepgram_key:
                try:
                    import httpx
                    headers = {
                        "Authorization": f"Token {deepgram_key}",
                        "Content-Type": "application/json"
                    }
                    async with httpx.AsyncClient(timeout=60.0) as http:
                        resp = await http.post(
                            "https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&diarize=true",
                            json={"url": audio_url},
                            headers=headers
                        )
                        if resp.status_code == 200:
                            dg_res = resp.json()
                            alts = dg_res.get("results", {}).get("channels", [{}])[0].get("alternatives", [{}])[0]
                            paragraphs = alts.get("paragraphs", {}).get("paragraphs", [])
                            for p in paragraphs:
                                for s in p.get("sentences", []):
                                    stext = s.get("text", "").strip()
                                    if stext:
                                        speech_segments.append(stext)
                            if not speech_segments and alts.get("transcript"):
                                speech_segments = [alts.get("transcript").strip()]
                            log.info("[Transcript] Deepgram transcribed %d sentence(s)", len(speech_segments))
                except Exception as dg_err:
                    log.warning("[Transcript] Deepgram transcription error: %s", dg_err)

            # Distribute speech segments to submitted questions
            submitted_indices = [i for i in range(len(questions)) if q_status_map.get(i) != "skipped"]
            assigned_answers = {}

            if len(submitted_indices) == 1:
                assigned_answers[submitted_indices[0]] = " ".join(speech_segments)
            elif len(submitted_indices) > 1 and speech_segments:
                k, m = divmod(len(speech_segments), len(submitted_indices))
                start = 0
                for i, q_idx in enumerate(submitted_indices):
                    sub_len = k + (1 if i < m else 0)
                    part = speech_segments[start:start + sub_len]
                    assigned_answers[q_idx] = " ".join(part)
                    start += sub_len

            session_id = f"mb_{bot_id}"
            now_iso = datetime.now().isoformat()

            # 1. Clean previous and insert individual submissions for each question
            db.submissions.delete_many({"session_id": session_id})
            formatted_answers = []

            for idx, q_text in enumerate(questions):
                st = q_status_map.get(idx, "submitted")
                ans_text = "" if st == "skipped" else assigned_answers.get(idx, "").strip()
                cat = "General" if idx == 0 else "Technical"

                sub_doc = {
                    "username": username,
                    "candidate_name": username,
                    "session_id": session_id,
                    "question_id": idx + 1,
                    "question_text": q_text,
                    "question": q_text,
                    "answer": ans_text,
                    "category": cat,
                    "status": st,
                    "submitted_at": now_iso,
                    "has_video": False
                }
                db.submissions.insert_one(sub_doc)

                formatted_answers.append({
                    "question_id": idx + 1,
                    "question": q_text,
                    "question_text": q_text,
                    "answer": ans_text,
                    "category": cat,
                    "status": st,
                    "duration_sec": 300,
                    "word_count": len(ans_text.split()) if ans_text else 0
                })

            log.info("[Transcript] Saved %d submissions for %s (session %s)", len(formatted_answers), username, session_id)

            from code.evaluation.routes import _run_final_evaluation
            asyncio.create_task(_run_final_evaluation(
                username=username, answers=formatted_answers,
                events=[], session_id=session_id
            ))
            log.info("[Transcript] Evaluation triggered successfully for %s", username)
        except Exception as e:
            log.error("[Transcript] Error for bot %s: %s", bot_id, e, exc_info=True)

    # ======================================================================
    #  LEGACY: in-memory engine event bridge (kept for compatibility)
    # ======================================================================
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
            update_exam_progress(username, ev.get("q_index", 0), ev.get("q_index", 0), ev.get("text", ""))
        elif ev_type == "answer_saved":
            q_idx = ev.get("q_index", 0)
            update_exam_progress(username, q_idx + 1, q_idx + 1, "")
        elif ev_type == "completed":
            update_exam_status(username, "completed")

    async def handle_bot_completion(self, completion_data: Dict[str, Any]):
        interview_id = completion_data.get("interview_id")
        candidate_name = completion_data.get("candidate_name", "Candidate")
        answers = completion_data.get("answers", [])

        record = db.active_meetings.find_one({"bot_interview_id": interview_id}) or \
                 db.timetables.find_one({"bot_interview_id": interview_id})
        username = record.get("candidate_username") or record.get("username") if record else candidate_name

        session_id = f"zoom_bot_{interview_id}"
        formatted = [{
            "question_id": str(a.get("q_index", 0)),
            "question": a.get("question", ""),
            "answer": a.get("answer", ""),
            "status": a.get("status", "submitted"),
            "duration_sec": a.get("duration_sec", 0),
            "word_count": a.get("word_count", 0)
        } for a in answers]

        db.submissions.update_one(
            {"session_id": session_id},
            {"$set": {
                "username": username, "candidate_name": candidate_name,
                "session_id": session_id, "provider": "zoom_bot",
                "answers": formatted, "total_questions": len(formatted),
                "status": "completed"
            }},
            upsert=True
        )
        unregister_active_exam(username)

        try:
            from code.evaluation.routes import _run_final_evaluation
            asyncio.create_task(_run_final_evaluation(
                username=username, answers=formatted,
                events=[], session_id=session_id
            ))
        except Exception as e:
            log.error("[ZoomBot] Evaluation failed for %s: %s", username, e)


zoom_bot_service = ZoomBotService()
