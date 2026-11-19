"""Zoom Web Client Adapter for the Self-Hosted AI Interviewer Bot."""
from __future__ import annotations

import asyncio
import base64
import logging
import re
from typing import List, Optional
from urllib.parse import parse_qs, urlencode, urlparse

from .base import BasePlatformAdapter, ChatMessage, FrameOrPage

log = logging.getLogger("self_hosted_bot.adapters.zoom")


def to_zoom_web_client_url(meeting_url: str, bot_name: Optional[str] = None) -> str:
    """
    Convert Zoom URLs into Zoom Web Client URLs so Chromium joins/starts directly in-browser:
    - Host Start URL (`.../s/123456?zak=TOKEN`) -> `https://app.zoom.us/wc/123456/start?zak=TOKEN`
    - Guest Join URL (`.../j/123456?pwd=XYZ`)   -> `https://app.zoom.us/wc/123456/join?pwd=XYZ&uname=...`
    """
    url = (meeting_url or "").strip()
    if not url or url.startswith("file://"):
        return url
    if "/wc/" in url:
        return url

    parsed = urlparse(url)
    match = re.search(r"/(j|s)/(\d+)", parsed.path)
    if not match:
        return url

    kind = match.group(1)
    meeting_id = match.group(2)
    qs = parse_qs(parsed.query)
    zak = (qs.get("zak") or [""])[0]
    pwd = (qs.get("pwd") or [""])[0]

    # Host start mode via ZAK token: bot auto-starts the meeting immediately (ZERO waiting for host!)
    if kind == "s" or zak:
        params = {}
        if zak:
            params["zak"] = zak
        web_url = f"https://app.zoom.us/wc/{meeting_id}/start"
        if params:
            web_url += "?" + urlencode(params)
        return web_url

    params = {}
    if pwd:
        params["pwd"] = pwd
    if bot_name:
        params["uname"] = base64.b64encode(bot_name.encode("utf-8")).decode("ascii")

    web_url = f"https://app.zoom.us/wc/{meeting_id}/join"
    if params:
        web_url += "?" + urlencode(params)
    return web_url


class ZoomWebAdapter(BasePlatformAdapter):
    platform_name = "zoom"

    def _candidate_frames(self) -> List[FrameOrPage]:
        """Return frames to inspect (webclient iframe first if present, then main page)."""
        frames: List[FrameOrPage] = []
        for frame in self.page.frames:
            try:
                name = (frame.name or "").lower()
                url = (frame.url or "").lower()
                if frame != self.page.main_frame and ("webclient" in name or "/wc/" in url or "zoom.us/wc" in url):
                    frames.append(frame)
            except Exception:
                continue
        frames.append(self.page)
        return frames

    def _active_frame(self) -> FrameOrPage:
        return self._candidate_frames()[0]

    async def _fill_name_strict(self, bot_name: str, timeout_sec: float = 12.0) -> bool:
        """Wait for Zoom's pre-join display name field, wipe any pre-filled value, and set bot_name."""
        selectors = [
            "#input-for-name",
            'input[id*="name" i]',
            'input[placeholder*="Your Name" i]',
            'input[placeholder*="Name" i]',
            'input[aria-label*="name" i]',
            'input[type="text"]',
        ]
        deadline = asyncio.get_event_loop().time() + timeout_sec
        while asyncio.get_event_loop().time() < deadline:
            for frame in self._candidate_frames():
                for sel in selectors:
                    try:
                        loc = frame.locator(sel).first
                        if await loc.is_visible(timeout=500):
                            await loc.click(timeout=1000)
                            await self.page.keyboard.press("Control+A")
                            await self.page.keyboard.press("Backspace")
                            await loc.fill(bot_name, timeout=1500)
                            val = (await loc.input_value(timeout=1000)).strip()
                            if val == bot_name:
                                log.info("[zoom] Set bot display name to '%s' via selector '%s'", bot_name, sel)
                                return True
                    except Exception:
                        continue
            await asyncio.sleep(0.4)
        log.warning("[zoom] Could not find name input before timeout (relying on URL uname param)")
        return False

    async def _rename_self_in_call(self, target_name: str) -> bool:
        """
        When starting Zoom as Host via ZAK token, Zoom initially labels the bot with the host's
        account name (e.g. 'Ankit'). This opens Participants, renames '(Host, me)' -> 'Interviewer',
        and closes Participants so the student ALWAYS sees 'Interviewer'!
        """
        try:
            for frame in self._candidate_frames():
                opened = await self._click_first([
                    'button[aria-label*="Participants" i]',
                    'button:has-text("Participants")',
                ], frame=frame, timeout_ms=2000)
                if not opened:
                    continue
                await asyncio.sleep(0.8)

                # Hover over our own participant row (contains "(Host, me)" or "(Me)")
                me_row = frame.locator(
                    'li:has-text("(Host, me)"), li:has-text("(Me)"), [class*="participants-item"]:has-text("(Host, me)"), [class*="participants-item"]:has-text("(Me)")'
                ).first
                if await me_row.is_visible(timeout=2000):
                    await me_row.hover()
                    await asyncio.sleep(0.3)

                    # Click "More" button on our row
                    clicked_more = await self._click_first([
                        'button:has-text("More")',
                        'button[aria-label*="More" i]',
                    ], frame=frame, timeout_ms=1500)
                    if clicked_more:
                        await asyncio.sleep(0.3)
                        if await self._click_first([
                            'a:has-text("Rename")',
                            'button:has-text("Rename")',
                            '[role="menuitem"]:has-text("Rename")',
                        ], frame=frame, timeout_ms=1500):
                            await asyncio.sleep(0.3)
                            inp = frame.locator('#newname, input[id*="name" i], input[type="text"]').last
                            if await inp.is_visible(timeout=1500):
                                await inp.click()
                                await self.page.keyboard.press("Control+A")
                                await self.page.keyboard.press("Backspace")
                                await inp.fill(target_name)
                                await self._click_first([
                                    'button:has-text("Change")',
                                    'button:has-text("OK")',
                                    'button:has-text("Save")',
                                ], frame=frame, timeout_ms=1500)
                                log.info("[zoom] Renamed Host bot in-call to '%s'", target_name)

                # Close Participants panel so Chat gets full width
                await self._click_first([
                    'button[aria-label*="Participants" i]',
                ], frame=frame, timeout_ms=1000)
                return True
        except Exception as exc:
            log.debug("[zoom] In-call rename notice: %s", exc)
        return False

    async def join(
        self,
        meeting_url: str,
        bot_name: Optional[str] = None,
        lobby_timeout_sec: int = 180,
    ) -> bool:
        # Always default to "Interviewer" (never the candidate's name!)
        self.bot_name = (bot_name or self.worker.config.bot_name or "Interviewer").strip()
        web_url = to_zoom_web_client_url(meeting_url, bot_name=self.bot_name)
        is_host_start = "/start" in web_url or "zak=" in web_url
        log.info("[zoom] Navigating to Zoom Web Client as '%s' (host_start=%s)", self.bot_name, is_host_start)
        await self.worker.open_url(web_url)
        await asyncio.sleep(2.5)

        # Dismiss cookie / privacy / terms banners if present
        for frame in self._candidate_frames():
            await self._click_first([
                "#onetrust-accept-btn-handler",
                'button:has-text("Accept Cookies")',
                'button:has-text("I Agree")',
                'button:has-text("Accept All")',
            ], frame=frame, timeout_ms=1200)

        if not is_host_start:
            # Guest join mode: fill bot display name + passcode + click Join
            await self._fill_name_strict(self.bot_name, timeout_sec=10.0)

            pwd = (parse_qs(urlparse(web_url).query).get("pwd") or [""])[0]
            if pwd:
                for frame in self._candidate_frames():
                    if await self._fill_first([
                        "#input-for-pwd",
                        'input[type="password"]',
                        'input[placeholder*="Passcode" i]',
                    ], pwd, frame=frame, timeout_ms=1200):
                        break

            for frame in self._candidate_frames():
                if await self._click_first([
                    "button.preview-join-button",
                    "#joinBtn",
                    'button:has-text("Join")',
                    'button[type="submit"]',
                ], frame=frame, timeout_ms=3000):
                    break
        else:
            # Host start mode (/wc/{id}/start?zak=...): click Start/Join if pre-join preview appears
            for frame in self._candidate_frames():
                await self._click_first([
                    "button.preview-join-button",
                    'button:has-text("Start")',
                    'button:has-text("Join")',
                ], frame=frame, timeout_ms=2500)

        # Wait through waiting room / lobby until inside active call
        joined = await self._wait_for_call_entry(timeout_sec=lobby_timeout_sec)
        if not joined:
            return False

        # Connect computer audio so candidate speech streams to our WebRTC audio tap
        await asyncio.sleep(1.5)
        for frame in self._candidate_frames():
            await self._click_first([
                'button:has-text("Join Audio by Computer")',
                'button.join-audio-by-voip__join-btn',
                'button[aria-label*="Join Audio" i]',
            ], frame=frame, timeout_ms=3000)

        # Ensure bot's virtual canvas camera is ON
        for frame in self._candidate_frames():
            await self._click_first([
                'button[aria-label*="Start Video" i]',
                'button[aria-label*="Start my video" i]',
            ], frame=frame, timeout_ms=1200)

        # When starting as Host via ZAK, rename our display label to "Interviewer"
        if is_host_start:
            await self._rename_self_in_call(self.bot_name)

        # Open chat panel cleanly
        await self.open_chat()
        return True

    async def is_in_call(self) -> bool:
        for frame in self._candidate_frames():
            if await self._any_visible([
                'button[aria-label*="Leave" i]',
                'button[aria-label*="End" i]',
                'button.footer__leave-btn',
                'button[aria-label*="Chat" i]',
                'button[aria-label*="Participants" i]',
                'button:has-text("Join Audio by Computer")',
            ], frame=frame, timeout_ms=600):
                return True
        return False

    async def open_chat(self) -> bool:
        input_checks = [
            '.ProseMirror[contenteditable="true"]',
            '.tiptap[contenteditable="true"]',
            'div.chat-rtf-box__editor-outer [contenteditable="true"]',
            'div[contenteditable="true"][aria-label*="message" i]',
            'div[contenteditable="true"][role="textbox"]',
            'textarea[placeholder*="Type message" i]',
            '.chat-box__chat-textarea',
            '[data-testid="chat-input"]',
        ]
        for frame in self._candidate_frames():
            if await self._any_visible(input_checks, frame=frame, timeout_ms=500):
                return True

        for frame in self._candidate_frames():
            clicked = await self._click_first([
                'button[aria-label*="open the chat pane" i]',
                'button[aria-label*="Chat" i]',
                'button:has-text("Chat")',
            ], frame=frame, timeout_ms=2000)
            if clicked:
                await asyncio.sleep(0.8)
                return True
        return False

    async def send_chat(self, text: str) -> bool:
        await self.open_chat()

        input_selectors = [
            '.ProseMirror[contenteditable="true"]',
            '.tiptap[contenteditable="true"]',
            'div.chat-rtf-box__editor-outer [contenteditable="true"]',
            'div.chat-rtf-box__editor [contenteditable="true"]',
            'div[contenteditable="true"][aria-label*="message" i]',
            'div[contenteditable="true"][aria-label*="chat" i]',
            'div[contenteditable="true"][role="textbox"]',
            'textarea[placeholder*="Type message" i]',
            '.chat-box__chat-textarea',
            '[data-testid="chat-input"]',
            # Fallback: Zoom's Meeting Group Chat box uses a single visible contenteditable div
            'div[contenteditable="true"]',
        ]
        send_btn_selectors = [
            'button.chat-rtf-box__send',
            'button[aria-label="send" i]',
            'button[aria-label*="Send" i]',
            'button[title*="Send" i]',
            'button[data-testid="send-chat"]',
        ]

        for frame in self._candidate_frames():
            ok = await self._type_and_send(
                input_selectors=input_selectors,
                text=text,
                frame=frame,
                send_button_selectors=send_btn_selectors,
            )
            if ok:
                log.info("[zoom] Chat message sent (%d chars)", len(text))
                return True

        log.warning("[zoom] Failed to locate Zoom chat input box to send message")
        return False

    async def read_new_messages(self) -> List[ChatMessage]:
        for frame in self._candidate_frames():
            try:
                raw_items = await frame.evaluate(
                    """() => {
                        const results = [];

                        // 1. Auto-scroll virtualized chat containers to bottom and dispatch scroll event
                        // so Zoom's virtualizer always renders the latest message into the DOM
                        try {
                            const scrollables = document.querySelectorAll(
                                '.chat-virtualized-list, [role="list"], .chat-box__chat-list, .chat-message-list, ' +
                                '.ReactVirtualized__Grid, .ReactVirtualized__List, [data-testid="chat-list"], ' +
                                '#chatPane, div.chat-container'
                            );
                            scrollables.forEach((sc) => {
                                if (sc && sc.scrollHeight > sc.clientHeight) {
                                    sc.scrollTop = sc.scrollHeight;
                                    sc.dispatchEvent(new Event('scroll', { bubbles: true }));
                                }
                            });
                        } catch (e) {}

                        // 2. Chat message bubbles & items
                        const containers = document.querySelectorAll(
                            '.chat-item__chat-info, .new-chat-message__container, .chat-message__container, .chat-message-item, [data-testid="chat-message"]'
                        );
                        containers.forEach((el) => {
                            const senderEl = el.querySelector(
                                '.chat-item__sender, .new-chat-message__sender, [class*="sender"], [data-testid="chat-sender"]'
                            );
                            const textEl = el.querySelector(
                                '.chat-message__text-content, .new-chat-message__text-content, .chat-rtf-box__text, [class*="text-content"], [data-testid="chat-text"]'
                            );
                            const text = (textEl ? textEl.innerText : el.innerText || "").trim();
                            const sender = (senderEl ? senderEl.innerText : "").trim();
                            if (text) {
                                let mid = el.getAttribute("data-id") || el.getAttribute("data-mid") || el.id;
                                if (!mid) {
                                    if (!el.dataset.botMid) {
                                        window.__botMsgSeq = (window.__botMsgSeq || 0) + 1;
                                        el.dataset.botMid = "zoom_m_" + window.__botMsgSeq;
                                    }
                                    mid = el.dataset.botMid;
                                }
                                results.push({
                                    id: mid,
                                    sender,
                                    text
                                });
                            }
                        });

                        // Fallback for Zoom's virtualized Meeting Group Chat list
                        if (results.length === 0) {
                            const items = document.querySelectorAll('[role="listitem"], .chat-virtualized-list > div');
                            items.forEach((item) => {
                                const txt = (item.innerText || "").trim();
                                if (!txt || txt.includes("Who can see your messages") || txt.includes("Meeting Group Chat")) return;
                                const lines = txt.split("\\n").map(s => s.trim()).filter(Boolean);
                                let mid = item.getAttribute("data-id") || item.id;
                                if (!mid) {
                                    if (!item.dataset.botMid) {
                                        window.__botMsgSeq = (window.__botMsgSeq || 0) + 1;
                                        item.dataset.botMid = "zoom_item_" + window.__botMsgSeq;
                                    }
                                    mid = item.dataset.botMid;
                                }
                                if (lines.length >= 2) {
                                    results.push({
                                        id: mid,
                                        sender: lines[0],
                                        text: lines.slice(1).join(" ")
                                    });
                                } else if (lines.length === 1) {
                                    results.push({
                                        id: mid,
                                        sender: "Candidate",
                                        text: lines[0]
                                    });
                                }
                            });
                        }

                        // 3. Fallback: Leaf scan for navigation command text anywhere in page
                        if (results.length === 0) {
                            const allLeaves = document.querySelectorAll('div, p, span');
                            allLeaves.forEach((el) => {
                                if (el.children.length === 0) {
                                    const t = (el.innerText || "").trim();
                                    if (t) {
                                        const low = t.toLowerCase();
                                        if (low.startsWith("/") || ["skip", "submit", "next", "repeat", "end"].includes(low)) {
                                            const tag = el.tagName.toLowerCase();
                                            if (tag === 'button' || el.closest('button')) return;
                                            let mid = el.dataset.botMid;
                                            if (!mid) {
                                                window.__botMsgSeq = (window.__botMsgSeq || 0) + 1;
                                                el.dataset.botMid = "zoom_leaf_" + window.__botMsgSeq;
                                                mid = el.dataset.botMid;
                                            }
                                            results.push({
                                                id: mid,
                                                sender: "Candidate",
                                                text: t
                                            });
                                        }
                                    }
                                }
                            });
                        }

                        return results;
                    }"""
                )
                if raw_items:
                    return self._filter_new_messages(raw_items)
            except Exception as exc:
                log.debug("[zoom] read_new_messages notice: %s", exc)
        return []

    async def start_screen_share(self) -> bool:
        """Click Zoom's Share button so our hooked getDisplayMedia() streams the 1280x720 Question Card FULL SCREEN!"""
        log.info("[zoom] Triggering full-screen Share for Question Display...")
        for frame in self._candidate_frames():
            clicked = await self._click_first([
                'button[aria-label*="Share Screen" i]',
                'button[aria-label="Share" i]',
                'button[aria-label*="Share" i]',
                'button.sharing-entry-button__btn',
                'button:has-text("Share")',
            ], frame=frame, timeout_ms=3000)
            if clicked:
                await asyncio.sleep(1.2)
                # Confirm any secondary Zoom Web share dialog if present
                await self._click_first([
                    'button:has-text("Share")',
                    'button:has-text("Continue")',
                    'button:has-text("OK")',
                ], frame=frame, timeout_ms=1200)
                log.info("[zoom] Full-screen Question Display Share triggered!")
                return True
        log.warning("[zoom] Share button not found — falling back to camera tile display")
        return False

    async def get_participant_count(self) -> Optional[int]:
        selectors = [
            '.footer-button__number-counter',
            'button[aria-label*="Participants" i] .footer-button__number-counter',
            'button[aria-label*="Participants" i]',
            '[data-testid="participant-count"]',
        ]
        for frame in self._candidate_frames():
            cnt = await self._extract_count_from_selectors(selectors, frame=frame)
            if cnt is not None:
                return cnt
        return None

    async def admit_waiting_participants(self) -> bool:
        for frame in self._candidate_frames():
            if await self._click_first([
                'button:has-text("Admit all")',
                'button:has-text("Admit")',
                'button[aria-label*="Admit" i]',
            ], frame=frame, timeout_ms=400):
                log.info("[zoom] Auto-admitted waiting candidate from lobby!")
                return True
        return False

    async def leave(self) -> None:
        for frame in self._candidate_frames():
            if await self._click_first([
                'button[aria-label*="Leave" i]',
                'button[aria-label*="End" i]',
                'button.footer__leave-btn',
                'button:has-text("End")',
                'button:has-text("Leave")',
            ], frame=frame, timeout_ms=2000):
                await asyncio.sleep(0.5)
                await self._click_first([
                    'button:has-text("End Meeting for All")',
                    'button:has-text("Leave Meeting")',
                    'button.leave-meeting-options__btn',
                ], frame=frame, timeout_ms=2000)
                return
