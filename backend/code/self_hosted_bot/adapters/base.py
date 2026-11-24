"""Base Platform Adapter interface and shared resilient DOM/chat helpers."""
from __future__ import annotations

import asyncio
import hashlib
import logging
import re
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, List, Optional, Sequence, Union

from playwright.async_api import Frame, Page

from ..browser_worker import BrowserWorker

log = logging.getLogger("self_hosted_bot.adapters")

FrameOrPage = Union[Page, Frame]


@dataclass
class ChatMessage:
    sender: str
    text: str
    timestamp: float
    msg_id: str


class BasePlatformAdapter(ABC):
    """Abstract adapter implemented by ZoomWebAdapter, GoogleMeetAdapter, and TeamsWebAdapter."""

    platform_name: str = "generic"

    def __init__(self, worker: BrowserWorker) -> None:
        self.worker = worker
        self.bot_name: str = worker.config.bot_name
        self._seen_msg_ids: set[str] = set()
        self._sent_texts: list[tuple[str, float]] = []

    @property
    def page(self) -> Page:
        if not self.worker.page:
            raise RuntimeError("BrowserWorker page is not initialized")
        return self.worker.page

    def _active_frame(self) -> FrameOrPage:
        """Override in adapters whose meeting UI lives inside an iframe (e.g., Zoom Web)."""
        return self.page

    # ------------------------------------------------------------------
    # Abstract lifecycle interface
    # ------------------------------------------------------------------
    @abstractmethod
    async def join(self, meeting_url: str, bot_name: Optional[str] = None, lobby_timeout_sec: int = 180) -> bool:
        """Navigate to meeting URL, fill bot name, join call, and wait through lobby."""

    @abstractmethod
    async def open_chat(self) -> bool:
        """Ensure the in-meeting chat panel is open and visible."""

    @abstractmethod
    async def send_chat(self, text: str) -> bool:
        """Post a chat message into the in-meeting chat."""

    @abstractmethod
    async def read_new_messages(self) -> List[ChatMessage]:
        """Return any newly arrived candidate chat messages (excluding bot's own messages)."""

    @abstractmethod
    async def is_in_call(self) -> bool:
        """Return True if the bot is currently inside the active call (past pre-join & lobby)."""

    @abstractmethod
    async def leave(self) -> None:
        """Gracefully disconnect from the meeting."""

    async def start_screen_share(self) -> bool:
        """Optional: trigger screen share (our getDisplayMedia hook streams the 1280x720 Canvas)."""
        return False

    async def is_candidate_screen_sharing(self) -> bool:
        """Return True if remote candidate is actively presenting or sharing their screen."""
        target = self._active_frame()
        try:
            return bool(
                await target.evaluate(
                    """() => {
                        // 1. Injected candidate video tap API check
                        if (window.__AI_CANDIDATE_VIDEO__ && typeof window.__AI_CANDIDATE_VIDEO__.isCandidateScreenSharing === 'function') {
                            if (window.__AI_CANDIDATE_VIDEO__.isCandidateScreenSharing()) return true;
                        }

                        // 2. Google Meet presentation selectors (remote presentation tile)
                        const meetPres = document.querySelector('[data-is-presentation="true"], [data-requested-participant-id*="presentation"], [data-participant-id*="presentation"], [jsname="h9sBje"]');
                        if (meetPres && (meetPres.offsetParent !== null || meetPres.clientWidth > 0)) return true;

                        // 3. Microsoft Teams presentation selectors (remote sharing surface)
                        const teamsPres = document.querySelector('[data-tid="presentation-surface"], [data-tid="screenshare-video-tile"], [data-tid="sharing-stage"]');
                        if (teamsPres && (teamsPres.offsetParent !== null || teamsPres.clientWidth > 0)) return true;

                        // 4. Zoom Web Client presentation selectors (incoming remote canvas)
                        const zoomPres = document.querySelector('canvas.share-screen-canvas, #share-screen-canvas, .sharing-view canvas, div.sharing-layout, [data-testid="sharing-view"]');
                        if (zoomPres && (zoomPres.offsetParent !== null || zoomPres.clientWidth > 0)) return true;

                        // 5. Generic aria-label and text indicators (excluding buttons and bot's own share)
                        const allAria = Array.from(document.querySelectorAll('[aria-label]'));
                        return allAria.some(el => {
                            if (el.tagName.toLowerCase() === 'button' || el.closest('button')) return false;
                            const a = (el.getAttribute('aria-label') || '').toLowerCase();
                            if (a.includes('you are sharing') || a.includes('your screen') || a.includes('stop share')) return false;
                            return (a.includes('is presenting') || a.includes('is sharing') || a.includes('presentation')) && !a.includes('your presentation');
                        });
                    }"""
                )
            )
        except Exception:
            return False

    async def get_participant_count(self) -> Optional[int]:
        """Return total participants currently in the call (including bot), or None if undetectable."""
        return None

    async def admit_waiting_participants(self) -> bool:
        """If bot is Host and a candidate is waiting in the lobby/waiting room, click Admit automatically."""
        return False

    async def _extract_count_from_selectors(
        self,
        selectors: Sequence[str],
        *,
        frame: Optional[FrameOrPage] = None,
    ) -> Optional[int]:
        """Inspect badge text and aria-label on candidate toolbar counters to extract integer participant count."""
        target = frame or self._active_frame()
        for sel in selectors:
            try:
                loc = target.locator(sel).first
                if not await loc.is_visible(timeout=350):
                    continue
                txt = (await loc.inner_text(timeout=350) or "").strip()
                aria = (await loc.get_attribute("aria-label", timeout=350) or "").strip()
                for source in (txt, aria):
                    m = re.search(r"\b(\d+)\b", source)
                    if m:
                        val = int(m.group(1))
                        if val >= 1:
                            return val
            except Exception:
                continue
        return None

    # ------------------------------------------------------------------
    # Shared resilient DOM helpers
    # ------------------------------------------------------------------
    async def _click_first(
        self,
        selectors: Sequence[str],
        *,
        frame: Optional[FrameOrPage] = None,
        timeout_ms: int = 2000,
    ) -> bool:
        target = frame or self._active_frame()
        for sel in selectors:
            try:
                loc = target.locator(sel).first
                if await loc.is_visible(timeout=timeout_ms):
                    await loc.click(timeout=timeout_ms)
                    return True
            except Exception:
                continue
        return False

    async def _fill_first(
        self,
        selectors: Sequence[str],
        value: str,
        *,
        frame: Optional[FrameOrPage] = None,
        timeout_ms: int = 2000,
    ) -> bool:
        target = frame or self._active_frame()
        for sel in selectors:
            try:
                loc = target.locator(sel).first
                if await loc.is_visible(timeout=timeout_ms):
                    await loc.click(timeout=timeout_ms)
                    await loc.fill(value, timeout=timeout_ms)
                    return True
            except Exception:
                continue
        return False

    async def _any_visible(
        self,
        selectors: Sequence[str],
        *,
        frame: Optional[FrameOrPage] = None,
        timeout_ms: int = 600,
    ) -> bool:
        target = frame or self._active_frame()
        for sel in selectors:
            try:
                if await target.locator(sel).first.is_visible(timeout=timeout_ms):
                    return True
            except Exception:
                continue
        return False

    async def _wait_for_call_entry(self, timeout_sec: int = 180, poll_interval: float = 2.0) -> bool:
        """Wait until `is_in_call()` becomes True (handles waiting room / lobby admission)."""
        deadline = time.time() + timeout_sec
        while time.time() < deadline:
            if await self.is_in_call():
                log.info("[%s] Bot admitted and active in call!", self.platform_name)
                return True
            await asyncio.sleep(poll_interval)
        log.warning("[%s] Timed out waiting in lobby after %ds", self.platform_name, timeout_sec)
        return False

    def _record_sent_message(self, text: str) -> None:
        """Remember our own outbound messages so we never echo-trigger commands on them."""
        now = time.time()
        norm = " ".join(text.strip().lower().split())
        self._sent_texts.append((norm, now))
        # Prune old entries (> 120s)
        self._sent_texts = [(t, ts) for t, ts in self._sent_texts if now - ts < 120]

    def _is_own_message(self, sender: str, text: str) -> bool:
        clean = (text or "").strip().lower().rstrip(".,!? ")
        # Candidate navigation commands are NEVER treated as own messages!
        if clean in ("/skip", "skip", "/submit", "submit", "/next", "next", "/repeat", "repeat", "/end", "end", "/start", "start"):
            return False

        s_low = (sender or "").strip().lower()
        b_low = (self.bot_name or "interviewer").strip().lower()
        if s_low in ("you", "me", b_low) or (b_low and b_low in s_low):
            return True
        norm = " ".join((text or "").strip().lower().split())
        if not norm:
            return True
        for sent_norm, _ in self._sent_texts:
            if norm == sent_norm or (len(norm) > 15 and norm in sent_norm):
                return True
        return False

    def _filter_new_messages(self, raw_items: List[dict[str, Any]]) -> List[ChatMessage]:
        """Deduplicate raw DOM chat snapshots and filter out bot's own messages."""
        new_msgs: List[ChatMessage] = []
        now = time.time()
        for idx, item in enumerate(raw_items):
            sender = str(item.get("sender") or "").strip()
            text = str(item.get("text") or "").strip()
            if not text:
                continue
            raw_id = str(item.get("id") or "").strip()
            if not raw_id:
                digest = hashlib.sha1(f"{idx}|{sender}|{text}".encode("utf-8")).hexdigest()[:16]
                raw_id = f"{self.platform_name}_{digest}"
            if raw_id in self._seen_msg_ids:
                continue
            self._seen_msg_ids.add(raw_id)
            if self._is_own_message(sender, text):
                continue
            new_msgs.append(ChatMessage(sender=sender or "Candidate", text=text, timestamp=now, msg_id=raw_id))
        return new_msgs

    async def _type_and_send(
        self,
        input_selectors: Sequence[str],
        text: str,
        *,
        frame: Optional[FrameOrPage] = None,
        send_button_selectors: Sequence[str] = (),
    ) -> bool:
        """Type multiline-safe message into chat box (textarea or contenteditable) and submit."""
        target = frame or self._active_frame()
        for sel in input_selectors:
            try:
                loc = target.locator(sel).first
                if not await loc.is_visible(timeout=700):
                    continue
                await loc.click(timeout=1500)
                await asyncio.sleep(0.1)

                tag = await loc.evaluate("(el) => el.tagName.toLowerCase()")
                is_ce = await loc.evaluate("(el) => Boolean(el.isContentEditable)")

                lines = text.splitlines()
                if tag in ("textarea", "input") and not is_ce:
                    await loc.fill(text, timeout=1500)
                else:
                    # contenteditable (e.g., Zoom ProseMirror/TipTap, MS Teams CKEditor)
                    for i, line in enumerate(lines):
                        if line:
                            await self.page.keyboard.insert_text(line)
                        if i < len(lines) - 1:
                            await self.page.keyboard.press("Shift+Enter")

                await asyncio.sleep(0.15)

                sent_via_btn = False
                for btn_sel in send_button_selectors:
                    try:
                        btn = target.locator(btn_sel).first
                        if await btn.is_visible(timeout=400) and await btn.is_enabled(timeout=400):
                            await btn.click(timeout=1000)
                            sent_via_btn = True
                            break
                    except Exception:
                        continue

                if not sent_via_btn:
                    await self.page.keyboard.press("Enter")

                self._record_sent_message(text)
                return True
            except Exception as exc:
                log.debug("[%s] Chat send selector '%s' failed: %s", self.platform_name, sel, exc)
                continue
        return False
