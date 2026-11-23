"""Autonomous Interview Orchestrator (State Machine) for the Self-Hosted Bot.

Coordinates:
- BrowserWorker (1280x720 Virtual Question Display Canvas + WebRTC Per-Question Audio Tap)
- Platform Adapter (Zoom Web / Google Meet / Microsoft Teams Web)
- Real-time Chat Commands (/submit, /skip, /repeat, /help, /end) + Debounce Safeguards
- Per-question Countdown Timer, 1-min Warning, and Smart Silence Nudge
- Parallel background STT transcription via AudioTranscriber (Deepgram Nova-3 / Local Whisper)
"""
from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, List, Optional, Sequence, Union

from .adapters import BasePlatformAdapter, ChatMessage, create_adapter_for_url
from .browser_worker import BrowserWorker
from .config import SelfHostedBotConfig, load_bot_config
from .transcriber import AudioTranscriber, TranscriptionResult

log = logging.getLogger("self_hosted_bot.orchestrator")


@dataclass
class InterviewQuestion:
    text: str
    time_limit_sec: int = 300
    category: str = "Technical"


@dataclass
class QuestionAnswerRecord:
    question_id: int
    question: str
    category: str
    status: str  # submitted | skipped | auto_submitted | ended
    answer: str = ""
    word_count: int = 0
    duration_sec: int = 0
    audio_path: Optional[str] = None
    stt_provider: str = "none"


@dataclass
class InterviewResult:
    session_id: str
    username: str
    candidate_name: str
    platform: str
    meeting_url: str
    status: str  # completed | aborted | failed
    answers: List[QuestionAnswerRecord] = field(default_factory=list)
    started_at: float = 0.0
    finished_at: float = 0.0
    error: Optional[str] = None
    video_file: Optional[str] = None
    video_path: Optional[str] = None

    def to_formatted_answers(self) -> List[Dict[str, Any]]:
        """Format answers matching the existing platform's `_run_final_evaluation` contract."""
        out = []
        for a in self.answers:
            if isinstance(a, dict):
                out.append({
                    "question_id": a.get("question_id", 1),
                    "question": a.get("question", a.get("question_text", "")),
                    "question_text": a.get("question_text", a.get("question", "")),
                    "answer": a.get("answer", ""),
                    "category": a.get("category", "Technical"),
                    "status": a.get("status", "submitted"),
                    "duration_sec": a.get("duration_sec", 0),
                    "word_count": a.get("word_count", 0),
                    "audio_path": a.get("audio_path"),
                })
            else:
                out.append({
                    "question_id": a.question_id,
                    "question": a.question,
                    "question_text": a.question,
                    "answer": a.answer,
                    "category": a.category,
                    "status": a.status,
                    "duration_sec": a.duration_sec,
                    "word_count": a.word_count,
                    "audio_path": a.audio_path,
                })
        return out


def normalize_questions(
    raw_questions: Sequence[Union[str, Dict[str, Any], InterviewQuestion]],
    default_time_limit_sec: int = 300,
) -> List[InterviewQuestion]:
    out: List[InterviewQuestion] = []
    for idx, q in enumerate(raw_questions):
        if isinstance(q, InterviewQuestion):
            out.append(q)
        elif isinstance(q, str):
            if q.strip():
                out.append(
                    InterviewQuestion(
                        text=q.strip(),
                        time_limit_sec=default_time_limit_sec,
                        category="General" if idx == 0 else "Technical",
                    )
                )
        elif isinstance(q, dict):
            text = (q.get("question") or q.get("text") or "").strip()
            if text:
                limit = int(q.get("time_limit_sec") or q.get("timer_seconds") or default_time_limit_sec)
                cat = str(q.get("category") or q.get("topic") or ("General" if idx == 0 else "Technical"))
                out.append(InterviewQuestion(text=text, time_limit_sec=limit, category=cat))
    return out


def parse_chat_command(text: str) -> Optional[str]:
    """Normalize candidate chat text into a canonical command or None."""
    clean = (text or "").strip().lower().rstrip(".,!? ")
    if not clean:
        return None
    if clean in ("/submit", "/next", "submit", "next") or clean.startswith("/submit"):
        return "/submit"
    if clean in ("/skip", "skip") or clean.startswith("/skip"):
        return "/skip"
    if clean in ("/repeat", "repeat", "/show", "show") or clean.startswith("/repeat"):
        return "/repeat"
    if clean in ("/help", "help") or clean.startswith("/help"):
        return "/help"
    if clean in ("/end", "/exit", "/stop", "end", "exit") or clean.startswith("/end"):
        return "/end"
    return None


def _fmt_mmss(sec: float) -> str:
    s = max(0, int(round(sec)))
    m, r = divmod(s, 60)
    return f"{m}:{r:02d}"


class InterviewOrchestrator:
    """Runs one complete self-hosted interview session from join to clean exit."""

    def __init__(
        self,
        *,
        username: str,
        candidate_name: str,
        meeting_url: str,
        questions: Sequence[Union[str, Dict[str, Any], InterviewQuestion]],
        session_id: Optional[str] = None,
        provider_hint: Optional[str] = None,
        config: Optional[SelfHostedBotConfig] = None,
        transcriber: Optional[AudioTranscriber] = None,
        on_progress: Optional[Callable[[str, int, int, str], Any]] = None,
        on_status: Optional[Callable[[str, str], Any]] = None,
        on_complete: Optional[Callable[[InterviewResult], Awaitable[None]]] = None,
        min_submit_debounce_sec: float = 1.2,
        transition_pause_sec: float = 2.0,
    ) -> None:
        self.config = config or load_bot_config()
        self.session_id = session_id or f"shb_{uuid.uuid4().hex[:10]}"
        self.username = username
        self.candidate_name = candidate_name or username
        self.meeting_url = meeting_url
        self.provider_hint = provider_hint
        self.questions = normalize_questions(questions, self.config.default_time_limit_sec)
        if not self.questions:
            self.questions = [
                InterviewQuestion("Please introduce yourself and your technical background.", 180, "General"),
                InterviewQuestion("Explain a challenging technical problem you solved recently.", 300, "Technical"),
            ]

        self.transcriber = transcriber or AudioTranscriber(self.config)
        self.on_progress = on_progress
        self.on_status = on_status
        self.on_complete = on_complete
        self.min_submit_debounce_sec = min_submit_debounce_sec
        self.transition_pause_sec = transition_pause_sec

        self.worker = BrowserWorker(self.config, username=self.username)
        self.adapter: Optional[BasePlatformAdapter] = None
        self._abort_requested: bool = False
        self._state_lock: Optional[asyncio.Lock] = None

        # Runtime state for admin status inspection
        self.status: str = "created"
        self.current_index: int = -1
        self.platform: str = provider_hint or "unknown"

    def request_abort(self) -> None:
        """Thread-safe signal to wrap up and exit early."""
        self._abort_requested = True

    def _emit_status(self, st: str) -> None:
        self.status = st
        if self.on_status:
            try:
                self.on_status(self.username, st)
            except Exception:
                pass

    def _emit_progress(self, q_idx: int, q_text: str) -> None:
        if self.on_progress:
            try:
                self.on_progress(self.username, q_idx, len(self.questions), q_text)
            except Exception:
                pass

    async def run(self) -> InterviewResult:
        self._state_lock = asyncio.Lock()
        started_at = time.time()
        audio_session_dir = self.config.audio_dir / self.session_id
        audio_session_dir.mkdir(parents=True, exist_ok=True)

        records: List[QuestionAnswerRecord] = []
        pending_stt: List[tuple[QuestionAnswerRecord, asyncio.Task[TranscriptionResult]]] = []
        final_status = "completed"
        err_msg: Optional[str] = None

        try:
            self._emit_status("joining")
            await self.worker.start()

            self.adapter = create_adapter_for_url(
                self.meeting_url, self.worker, provider_hint=self.provider_hint
            )
            self.platform = self.adapter.platform_name

            # Pre-render Welcome Card BEFORE entering the call so the camera tile is ready immediately
            first_topic = self.questions[0].category if self.questions else "Technical Interview"
            await self.worker.show_welcome(
                candidate_name=self.candidate_name,
                total_questions=len(self.questions),
                topic=first_topic,
            )

            log.info("[Orchestrator:%s] Joining %s for %s...", self.session_id, self.platform, self.username)
            joined = await self.adapter.join(
                self.meeting_url,
                bot_name=self.config.bot_name,
                lobby_timeout_sec=self.config.lobby_wait_timeout_sec,
            )
            if not joined:
                final_status = "failed"
                err_msg = f"Bot was not admitted to {self.platform} call within {self.config.lobby_wait_timeout_sec}s"
                log.warning("[Orchestrator:%s] %s", self.session_id, err_msg)
                self._emit_status("failed")
                return InterviewResult(
                    session_id=self.session_id,
                    username=self.username,
                    candidate_name=self.candidate_name,
                    platform=self.platform,
                    meeting_url=self.meeting_url,
                    status=final_status,
                    started_at=started_at,
                    finished_at=time.time(),
                    error=err_msg,
                )

            # Re-apply welcome card on the live call page context
            await self.worker.show_welcome(
                candidate_name=self.candidate_name,
                total_questions=len(self.questions),
                topic=first_topic,
            )

            # Start full-screen Question Display via Screen Share (falls back gracefully to camera tile)
            try:
                shared = await self.adapter.start_screen_share()
                if shared:
                    await asyncio.sleep(1.0)
                    await self.adapter.open_chat()
            except Exception as share_err:
                log.debug("[Orchestrator:%s] Screen share fallback notice: %s", self.session_id, share_err)

            # ------------------------------------------------------------------
            # CANDIDATE ARRIVAL GATE: Do NOT send Q1 or start timers while room is empty!
            # Wait patiently until the candidate actually joins (handles slow mobile/WiFi).
            # ------------------------------------------------------------------
            arrived = await self._wait_for_candidate_arrival()
            if not arrived:
                final_status = "no_show" if not self._abort_requested else "aborted"
                err_msg = (
                    f"Candidate {self.candidate_name} did not join within {self.config.candidate_wait_timeout_sec}s"
                    if final_status == "no_show"
                    else "Interview aborted before candidate joined"
                )
                log.warning("[Orchestrator:%s] %s", self.session_id, err_msg)
                if await self.adapter.is_in_call():
                    await self.adapter.leave()
                self._emit_status(final_status)
                return InterviewResult(
                    session_id=self.session_id,
                    username=self.username,
                    candidate_name=self.candidate_name,
                    platform=self.platform,
                    meeting_url=self.meeting_url,
                    status=final_status,
                    started_at=started_at,
                    finished_at=time.time(),
                    error=err_msg,
                )

            # Give candidate's chat & audio UI a brief settle moment so greeting is 100% visible
            if self.config.candidate_settle_sec > 0:
                await asyncio.sleep(self.config.candidate_settle_sec)

            # Start continuous candidate face video recording (Admin Live View + Post-Interview Playback)
            try:
                from code.config.settings import UPLOADS_DIR
                ts_ms = int(time.time() * 1000)
                rec_filename = f"exam_{self.username}_{ts_ms}.webm"
                rec_target = UPLOADS_DIR / rec_filename
                self._current_video_filename = rec_filename
                self._current_video_path = str(rec_target)
                await self.worker.start_candidate_video_recording(self.candidate_name, save_path=rec_target)
            except Exception as vid_start_err:
                log.warning("[Orchestrator:%s] Candidate video recording start notice: %s", self.session_id, vid_start_err)

            # Send greeting AFTER candidate has joined so they never miss it!
            ready_sec = max(0, int(self.config.ready_buffer_sec))
            if ready_sec > 0:
                await self.worker.update_display({
                    "statusText": f"Candidate joined! Type /start to begin now (auto-starting in {ready_sec}s)...",
                })
                await self.adapter.send_chat(
                    f"👋 Welcome {self.candidate_name}! I am your Interviewer.\n"
                    f"We have {len(self.questions)} questions today. Each question will be shown on screen AND in this chat.\n"
                    f"Speak clearly into your mic, then type /submit when done (or /skip to skip).\n\n"
                    f"👉 Type /start whenever you are ready — or Question 1 will begin automatically in {ready_sec} seconds!"
                )
                await self._wait_for_ready_buffer(ready_sec)
            else:
                await self.adapter.send_chat(
                    f"👋 Welcome {self.candidate_name}! I am your Interviewer.\n"
                    f"We have {len(self.questions)} questions today. Each question will be shown on screen AND in this chat.\n"
                    f"Speak clearly into your mic, then type /submit when done (or /skip to skip)."
                )
                await asyncio.sleep(min(2.0, self.transition_pause_sec))

            self._emit_status("in_progress")

            # Flush any pre-interview chat chatter
            await self.adapter.read_new_messages()

            total = len(self.questions)
            for idx, q in enumerate(self.questions):
                if self._abort_requested:
                    final_status = "aborted"
                    break

                self.current_index = idx
                self._emit_progress(idx, q.text)

                # 1. Update On-Screen Visual Question Card + Start Live Countdown
                await self.worker.show_question(
                    candidate_name=self.candidate_name,
                    q_index=idx,
                    total_questions=total,
                    question_text=q.text,
                    time_limit_sec=q.time_limit_sec,
                    topic=q.category,
                )

                # 2. Simultaneously Post Question in Meeting Chat
                mins_label = (
                    f"{q.time_limit_sec // 60} min"
                    if q.time_limit_sec >= 60
                    else f"{q.time_limit_sec} sec"
                )
                await self.adapter.send_chat(
                    f"📝 Question {idx + 1} of {total} ({q.category}):\n\n"
                    f"{q.text}\n\n"
                    f"⏱️ Time limit: {mins_label}. Speak your answer clearly!\n"
                    f"👉 Type /submit when done, /skip to skip, or /repeat to view again."
                )

                # 3. Start exact per-question audio capture segment
                q_started_at = time.time()
                await self.worker.start_audio_segment(idx)

                # 4. Wait for candidate command, timer expiry, or call disconnect
                outcome = await self._wait_for_question_outcome(idx, q, q_started_at)
                elapsed_sec = max(1, int(round(time.time() - q_started_at)))

                # 5. Stop exact per-question audio capture segment
                q_audio_path = audio_session_dir / f"q{idx + 1}.webm"
                stop_info = await self.worker.stop_audio_segment(
                    save_path=q_audio_path if outcome != "skipped" else None
                )
                saved_audio = stop_info.get("saved_path")

                rec = QuestionAnswerRecord(
                    question_id=idx + 1,
                    question=q.text,
                    category=q.category,
                    status=outcome,
                    duration_sec=elapsed_sec,
                    audio_path=saved_audio,
                )
                records.append(rec)

                # 6. Fire parallel background transcription immediately while moving on!
                if outcome in ("submitted", "auto_submitted", "ended") and saved_audio:
                    stt_task = asyncio.create_task(self.transcriber.transcribe_file(Path(saved_audio)))
                    pending_stt.append((rec, stt_task))

                # 7. Show Transition Card + Chat Confirmation
                if outcome == "ended":
                    await self.worker.show_transition(
                        "Interview Ended Early",
                        "Saving your responses and preparing evaluation...",
                        icon="⏹️",
                        color="#f59e0b",
                    )
                    await self.adapter.send_chat("⏹️ Interview ended. Generating your evaluation report...")
                    break
                elif outcome == "disconnected":
                    rec.status = "auto_submitted"
                    final_status = "completed"
                    log.warning("[Orchestrator:%s] Call disconnected during Q%d", self.session_id, idx + 1)
                    break
                elif outcome == "skipped":
                    await self.worker.show_transition(
                        f"Question {idx + 1} Skipped",
                        f"Loading Question {idx + 2} of {total}..." if idx + 1 < total else "Wrapping up...",
                        icon="⏭️",
                        color="#f59e0b",
                    )
                    await self.adapter.send_chat(f"⏭️ Question {idx + 1} skipped!")
                elif outcome == "submitted":
                    await self.worker.show_transition(
                        f"Question {idx + 1} Answer Recorded!",
                        f"Loading Question {idx + 2} of {total}..." if idx + 1 < total else "Wrapping up...",
                        icon="✅",
                        color="#10b981",
                    )
                    await self.adapter.send_chat(f"✅ Question {idx + 1} answer recorded!")
                else:  # auto_submitted (timeout)
                    await self.worker.show_transition(
                        f"Time's Up for Question {idx + 1}!",
                        f"Moving to Question {idx + 2}..." if idx + 1 < total else "Wrapping up...",
                        icon="⏳",
                        color="#38bdf8",
                    )
                    await self.adapter.send_chat(f"⏳ Time's up for Question {idx + 1}! Moving on...")

                if idx + 1 < total and not self._abort_requested:
                    await asyncio.sleep(self.transition_pause_sec)

            # Fill any remaining unanswered questions (e.g., if ended early)
            answered_ids = {r.question_id for r in records}
            for idx, q in enumerate(self.questions):
                if (idx + 1) not in answered_ids:
                    records.append(
                        QuestionAnswerRecord(
                            question_id=idx + 1,
                            question=q.text,
                            category=q.category,
                            status="skipped",
                        )
                    )

            # Show Completion Screen + Closing Chat
            if await self.adapter.is_in_call():
                await self.worker.show_completed(self.candidate_name)
                await self.adapter.send_chat(
                    f"🎉 Congratulations {self.candidate_name}!\n"
                    f"All questions completed. Thank you for your responses — your interview session is now concluding and your evaluation report is being generated."
                )
                await asyncio.sleep(min(2.5, self.transition_pause_sec))

            # Finalize & save candidate face video recording (.webm)
            saved_video_file = getattr(self, "_current_video_filename", None)
            saved_video_path = getattr(self, "_current_video_path", None)
            try:
                import os
                rec_target = Path(saved_video_path) if saved_video_path else None
                vid_res = await self.worker.stop_candidate_video_recording(save_path=rec_target)
                if vid_res.get("saved_path") and os.path.exists(vid_res["saved_path"]) and os.path.getsize(vid_res["saved_path"]) > 0:
                    saved_video_file = getattr(self, "_current_video_filename", None) or os.path.basename(vid_res["saved_path"])
                    saved_video_path = vid_res["saved_path"]
                    log.info("[Orchestrator:%s] Successfully finalized candidate interview video to %s (%d bytes)", self.session_id, saved_video_path, os.path.getsize(saved_video_path))
                elif saved_video_path and os.path.exists(saved_video_path) and os.path.getsize(saved_video_path) > 0:
                    saved_video_file = getattr(self, "_current_video_filename", None) or os.path.basename(saved_video_path)
                    log.info("[Orchestrator:%s] Preserved streamed candidate interview video at %s (%d bytes)", self.session_id, saved_video_path, os.path.getsize(saved_video_path))
                else:
                    saved_video_file = None
                    saved_video_path = None
            except Exception as vid_stop_err:
                log.warning("[Orchestrator:%s] Video recording stop warning: %s", self.session_id, vid_stop_err)

            if await self.adapter.is_in_call():
                await self.adapter.leave()

            # Collect all parallel background transcription results
            if pending_stt:
                log.info("[Orchestrator:%s] Finalizing %d parallel STT tasks...", self.session_id, len(pending_stt))
                for rec, task in pending_stt:
                    try:
                        tr = await asyncio.wait_for(task, timeout=60.0)
                        rec.answer = tr.text
                        rec.word_count = tr.word_count
                        rec.stt_provider = tr.provider
                    except Exception as stt_err:
                        log.warning("[Orchestrator:%s] STT task Q%d notice: %s", self.session_id, rec.question_id, stt_err)

            self._emit_status(final_status)
            result = InterviewResult(
                session_id=self.session_id,
                username=self.username,
                candidate_name=self.candidate_name,
                platform=self.platform,
                meeting_url=self.meeting_url,
                status=final_status,
                answers=records,
                started_at=started_at,
                finished_at=time.time(),
                video_file=saved_video_file,
                video_path=saved_video_path,
            )
            if self.on_complete:
                await self.on_complete(result)
            return result

        except Exception as exc:
            err_msg = str(exc)
            log.error("[Orchestrator:%s] Fatal error: %s", self.session_id, exc, exc_info=True)
            self._emit_status("failed")
            return InterviewResult(
                session_id=self.session_id,
                username=self.username,
                candidate_name=self.candidate_name,
                platform=self.platform,
                meeting_url=self.meeting_url,
                status="failed",
                answers=records,
                started_at=started_at,
                finished_at=time.time(),
                video_file=getattr(self, "_current_video_filename", None),
                video_path=getattr(self, "_current_video_path", None),
                error=err_msg,
            )
        finally:
            await self.worker.stop()

    async def _wait_for_candidate_arrival(self) -> bool:
        """
        Wait until the candidate actually joins the call before posting Welcome & Q1.
        Detects arrival via:
          1) Platform participant counter >= 2 (Zoom / Google Meet / Teams toolbar counter)
          2) Incoming remote WebRTC audio track (`tappedTracks >= 1`)
          3) Any chat message sent by the candidate
        Also auto-admits any waiting-room candidate if the bot is Host!
        """
        assert self.adapter is not None
        timeout_sec = max(1, int(self.config.candidate_wait_timeout_sec))
        self._emit_status("waiting_for_candidate")
        await self.worker.update_display({
            "mode": "welcome",
            "statusText": f"Waiting for {self.candidate_name} to join the meeting...",
        })
        log.info(
            "[Orchestrator:%s] Waiting for candidate '%s' to join (max %ds)...",
            self.session_id,
            self.candidate_name,
            timeout_sec,
        )

        deadline = time.time() + timeout_sec
        last_alive_check = time.time()

        while time.time() < deadline:
            if self._abort_requested:
                return False

            # 0. Auto-admit if candidate is waiting in lobby/waiting room
            try:
                await self.adapter.admit_waiting_participants()
            except Exception:
                pass

            # 1. Primary signal: Participant count >= 2
            count = await self.adapter.get_participant_count()
            if count is not None and count >= 2:
                log.info(
                    "[Orchestrator:%s] Candidate detected! (participant_count=%d)",
                    self.session_id,
                    count,
                )
                return True

            # 2. Secondary signal: Incoming candidate WebRTC audio track
            audio_st = await self.worker.get_audio_status()
            if audio_st.get("tappedTracks", 0) >= 1:
                log.info(
                    "[Orchestrator:%s] Candidate detected via incoming WebRTC audio track!",
                    self.session_id,
                )
                return True

            # 3. Tertiary signal: Candidate sent any chat message
            msgs = await self.adapter.read_new_messages()
            if msgs:
                log.info(
                    "[Orchestrator:%s] Candidate detected via chat message ('%s')!",
                    self.session_id,
                    msgs[0].text[:40],
                )
                return True

            # Periodic call health check
            now = time.time()
            if now - last_alive_check >= 5.0:
                last_alive_check = now
                if not await self.adapter.is_in_call():
                    log.warning("[Orchestrator:%s] Meeting closed while waiting for candidate", self.session_id)
                    return False

            await asyncio.sleep(1.0)

        return False

    async def _wait_for_ready_buffer(self, ready_sec: int) -> None:
        """
        Give the candidate a short breathing buffer (default 15s) to put on headphones & read
        instructions, OR start Question 1 immediately if they type `/start` or `ready`.
        """
        assert self.adapter is not None
        deadline = time.time() + ready_sec
        last_shown_sec = -1

        while time.time() < deadline:
            if self._abort_requested:
                return

            rem = max(0, int(round(deadline - time.time())))
            if rem != last_shown_sec and rem % 3 == 0:
                last_shown_sec = rem
                await self.worker.update_display({
                    "statusText": f"Starting Question 1 in {rem}s... (or type /start in chat to begin now)",
                })

            msgs = await self.adapter.read_new_messages()
            for msg in msgs:
                clean = (msg.text or "").strip().lower().rstrip(".,!? ")
                if clean in ("/start", "start", "/ready", "ready", "yes", "ok", "okay") or clean.startswith("/start"):
                    log.info("[Orchestrator:%s] Candidate signaled '%s' — starting Q1 immediately!", self.session_id, clean)
                    return

            await asyncio.sleep(0.5)

    async def _wait_for_question_outcome(
        self,
        q_idx: int,
        q: InterviewQuestion,
        q_started_at: float,
    ) -> str:
        """
        Active monitoring loop for one question.
        Returns one of: 'submitted' | 'skipped' | 'auto_submitted' | 'ended' | 'disconnected'
        """
        assert self.adapter is not None
        deadline = q_started_at + q.time_limit_sec
        warned_low_time = False
        sent_silence_nudge = False
        last_alive_check = time.time()
        candidate_left_since = 0.0

        while time.time() < deadline:
            if self._abort_requested:
                return "ended"

            now = time.time()
            remaining = deadline - now
            elapsed = now - q_started_at

            # 1. Check incoming candidate chat commands
            messages: List[ChatMessage] = await self.adapter.read_new_messages()
            for msg in messages:
                cmd = parse_chat_command(msg.text)
                if not cmd:
                    continue

                # Anti-burst debounce guard for advancing commands
                if cmd in ("/submit", "/skip", "/end") and elapsed < self.min_submit_debounce_sec:
                    log.info("[Orchestrator:%s] Debounced rapid '%s' (%.2fs elapsed)", self.session_id, cmd, elapsed)
                    continue

                async with self._state_lock:
                    if cmd == "/submit":
                        return "submitted"
                    if cmd == "/skip":
                        return "skipped"
                    if cmd == "/end":
                        return "ended"
                    if cmd == "/repeat":
                        await self.adapter.send_chat(
                            f"🔁 Question {q_idx + 1} of {len(self.questions)} ({_fmt_mmss(remaining)} left):\n\n{q.text}"
                        )
                    elif cmd == "/help":
                        await self.adapter.send_chat(
                            "📖 Commands: /submit (save & next) • /skip (skip question) • /repeat (show question again) • /end (finish early)"
                        )

            # 2. 1-minute remaining warning
            if (
                not warned_low_time
                and q.time_limit_sec > self.config.warn_before_sec + 15
                and remaining <= self.config.warn_before_sec
            ):
                warned_low_time = True
                await self.adapter.send_chat(
                    f"⏰ {_fmt_mmss(remaining)} remaining for Question {q_idx + 1}. Type /submit when ready!"
                )

            # 3. Smart Silence Detection Nudge
            if (
                not sent_silence_nudge
                and elapsed >= self.config.silence_timeout_sec
                and remaining > self.config.warn_before_sec
            ):
                audio_st = await self.worker.get_audio_status()
                ms_since = audio_st.get("msSinceSpeech")
                silent_long_enough = (ms_since is None) or (ms_since >= self.config.silence_timeout_sec * 1000)
                if silent_long_enough:
                    sent_silence_nudge = True
                    await self.adapter.send_chat(
                        f"💡 Still thinking? You have {_fmt_mmss(remaining)} left. Speak your answer, or type /skip to move on."
                    )

            # 4. Periodic call health & Candidate Departure check every 3s
            if now - last_alive_check >= 3.0:
                last_alive_check = now
                if not await self.adapter.is_in_call():
                    return "disconnected"

                # Check if candidate has left the call (bot alone in room)
                has_alone_banner = False
                if hasattr(self.adapter, "has_everyone_else_left"):
                    try:
                        has_alone_banner = await self.adapter.has_everyone_else_left()
                    except Exception:
                        has_alone_banner = False

                count = await self.adapter.get_participant_count()
                is_alone = (count is not None and count <= 1) or has_alone_banner
                if is_alone:
                    if candidate_left_since == 0.0:
                        candidate_left_since = now
                        log.info("[Orchestrator:%s] Room participant count <= 1 (candidate may have left). Watching...", self.session_id)
                    elif now - candidate_left_since >= 10.0:  # 10s grace period for brief network hiccups
                        log.warning("[Orchestrator:%s] Candidate departed (room empty for %.1fs) — ending interview cleanly", self.session_id, now - candidate_left_since)
                        return "disconnected"
                else:
                    candidate_left_since = 0.0

            await asyncio.sleep(0.5)

        return "auto_submitted"
