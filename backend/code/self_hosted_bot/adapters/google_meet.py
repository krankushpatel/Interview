"""Google Meet Adapter for the Self-Hosted AI Interviewer Bot."""
from __future__ import annotations

import asyncio
import logging
from typing import List, Optional

from .base import BasePlatformAdapter, ChatMessage

log = logging.getLogger("self_hosted_bot.adapters.google_meet")


class GoogleMeetAdapter(BasePlatformAdapter):
    platform_name = "google_meet"

    async def join(
        self,
        meeting_url: str,
        bot_name: Optional[str] = None,
        lobby_timeout_sec: int = 180,
    ) -> bool:
        self.bot_name = bot_name or self.worker.config.bot_name
        log.info("[google_meet] Navigating to Google Meet: %s", meeting_url)
        await self.worker.open_url(meeting_url)
        await asyncio.sleep(2.5)

        # Dismiss any intro modal ("Got it", "Dismiss") — never disable mic/camera!
        await self._click_first([
            'button:has-text("Got it")',
            'button:has-text("Dismiss")',
        ], timeout_ms=1500)

        # Guest name input (shown on Workspace OPEN rooms for unauthenticated Interviewer)
        name_filled = False
        name_deadline = asyncio.get_event_loop().time() + 8.0
        while asyncio.get_event_loop().time() < name_deadline:
            if await self._fill_first([
                'input[aria-label="Your name"]',
                'input[placeholder*="Your name" i]',
                'input[type="text"]',
            ], self.bot_name, timeout_ms=800):
                name_filled = True
                log.info("[google_meet] Filled guest display name as '%s'", self.bot_name)
                break
            # If Join button is already visible without name field (signed-in profile), proceed
            if await self._any_visible(['button:has-text("Join now")', 'button:has-text("Ask to join")'], timeout_ms=400):
                break
            await asyncio.sleep(0.4)

        # Click Join now (instant on OPEN rooms) or Ask to join
        clicked_join = await self._click_first([
            'button:has-text("Join now")',
            'button:has-text("Ask to join")',
            'button:has-text("Join anyway")',
            'button[jsname="Qx7uuf"]',
        ], timeout_ms=5000)

        if not clicked_join:
            log.warning("[google_meet] Could not locate Join/Ask to join button — checking if already in call")

        joined = await self._wait_for_call_entry(timeout_sec=lobby_timeout_sec)
        if not joined:
            return False

        # Dismiss post-join tooltips ("Got it")
        await asyncio.sleep(1.0)
        await self._click_first(['button:has-text("Got it")'], timeout_ms=1200)
        await self.open_chat()
        return True

    async def is_in_call(self) -> bool:
        return await self._any_visible([
            'button[aria-label*="Leave call" i]',
            'button[aria-label*="Chat" i]',
            'button[aria-label*="messages" i]',
            'button[aria-label*="Show everyone" i]',
            'button[data-testid="leave-call"]',
        ], timeout_ms=700)

    async def is_chat_open(self) -> bool:
        try:
            return bool(await self.page.evaluate("""() => {
                const input = document.querySelector('textarea[name="chatTextInput"], textarea[aria-label*="message" i], textarea[aria-label*="chat" i], [data-testid="chat-input"]');
                return Boolean(input && input.offsetParent !== null);
            }"""))
        except Exception:
            return False

    async def open_chat(self) -> bool:
        if await self.is_chat_open():
            return True

        # Try fast DOM click via JavaScript first
        try:
            opened = await self.page.evaluate("""() => {
                const buttons = Array.from(document.querySelectorAll('button, div[role="button"], [data-panel-id]'));
                const chatBtn = buttons.find(b => {
                    const aria = (b.getAttribute('aria-label') || '').toLowerCase();
                    const text = (b.innerText || '').toLowerCase();
                    const panelId = b.getAttribute('data-panel-id');
                    const jsname = b.getAttribute('jsname');
                    return (
                        aria.includes('chat') ||
                        aria.includes('message') ||
                        text.includes('chat') ||
                        panelId === '2' ||
                        jsname === 'A5il2e'
                    );
                });
                if (chatBtn) {
                    chatBtn.click();
                    return true;
                }
                return false;
            }""")
            if opened:
                await asyncio.sleep(0.4)
                return True
        except Exception:
            pass

        clicked = await self._click_first([
            'button[aria-label*="In-call messages" i]',
            'button[aria-label*="Chat with everyone" i]',
            'button[aria-label*="messages" i]',
            'button[aria-label*="Chat" i]',
            'button[data-panel-id="2"]',
            'button[jsname="A5il2e"]',
            'button[aria-label*="Send a message" i]',
        ], timeout_ms=800)
        if clicked:
            await asyncio.sleep(0.4)
        return clicked

    async def send_chat(self, text: str) -> bool:
        await self.open_chat()
        return await self._type_and_send(
            input_selectors=[
                'textarea[aria-label*="Send a message" i]',
                'textarea[aria-label*="message" i]',
                'textarea[aria-label*="chat" i]',
                'textarea[placeholder*="message" i]',
                'textarea[placeholder*="chat" i]',
                'input[aria-label*="Send a message" i]',
                'input[aria-label*="message" i]',
                'textarea[name="chatTextInput"]',
                '[data-testid="chat-input"]',
                'textarea',
            ],
            text=text,
            send_button_selectors=[
                'button[aria-label*="Send a message" i]',
                'button[aria-label*="Send" i]',
                'button[data-testid="send-chat"]',
                'button[jsname="sohScb"]',
            ],
        )

    async def read_new_messages(self) -> List[ChatMessage]:
        try:
            # Keep chat panel open so message elements are continually rendered in DOM
            if not await self.is_chat_open():
                await self.open_chat()

            raw_items = await self.page.evaluate(
                """() => {
                    const results = [];

                    // 1. Toast alerts / popups (e.g. "Ankush: /skip")
                    const toasts = document.querySelectorAll('[role="alert"], .vvNkMd, .nM4R6, [data-notification-id]');
                    toasts.forEach((t) => {
                        const full = (t.innerText || "").trim();
                        if (full) {
                            let sender = "Candidate";
                            let text = full;
                            if (full.includes(":")) {
                                const parts = full.split(":", 2);
                                sender = parts[0].trim();
                                text = parts[1].trim();
                            }
                            if (text) {
                                let mid = t.id || t.getAttribute("data-notification-id");
                                if (!mid) {
                                    if (!t.dataset.botMid) {
                                        window.__botMsgSeq = (window.__botMsgSeq || 0) + 1;
                                        t.dataset.botMid = "toast_m_" + window.__botMsgSeq;
                                    }
                                    mid = t.dataset.botMid;
                                }
                                results.push({ id: mid, sender: sender || "Candidate", text });
                            }
                        }
                    });

                    // 2. Chat panel container (careful: never match toggle buttons with aria-label)
                    const chatPanel = document.querySelector(
                        'div[data-panel-id="2"], section[data-panel-id="2"], aside[data-panel-id="2"], ' +
                        'div[role="region"][aria-label*="messages" i], div[role="region"][aria-label*="chat" i], ' +
                        'div[role="complementary"], #chatPane, div[jsname="ME4pnd"]'
                    );
                    const panelRoot = chatPanel || document;
                    const bubbles = panelRoot.querySelectorAll(
                        '.oIy2qc, [data-message-text], [data-testid="chat-text"], [jsname="W297wb"], .Zmm6We, .behkoc'
                    );

                    if (bubbles.length > 0) {
                        bubbles.forEach((b) => {
                            const text = (b.getAttribute("data-message-text") || b.innerText || "").trim();
                            if (!text) return;
                            const parent = b.closest('[data-sender-name], [role="listitem"], .GDhqjd, div[jsname="d9be4e"]') || b.parentElement;
                            const sender = parent ? (parent.getAttribute("data-sender-name") || (parent.querySelector('.YTbUzc, [data-self-name]') ? parent.querySelector('.YTbUzc, [data-self-name]').innerText : "")) : "";
                            let mid = b.getAttribute("data-message-id") || b.getAttribute("data-mid") || b.id;
                            if (!mid) {
                                if (!b.dataset.botMid) {
                                    window.__botMsgSeq = (window.__botMsgSeq || 0) + 1;
                                    b.dataset.botMid = "meet_m_" + window.__botMsgSeq;
                                }
                                mid = b.dataset.botMid;
                            }
                            results.push({ id: mid, sender: sender || "Candidate", text });
                        });
                    } else {
                        // Fallback to container items if .oIy2qc is not present
                        const items = panelRoot.querySelectorAll('.GDhqjd, [role="listitem"]');
                        items.forEach((item) => {
                            const text = (item.getAttribute("data-message-text") || item.innerText || "").trim();
                            if (!text) return;
                            const sender = item.getAttribute("data-sender-name") || (item.querySelector('.YTbUzc, [data-self-name]') ? item.querySelector('.YTbUzc, [data-self-name]').innerText : "");
                            let mid = item.getAttribute("data-message-id") || item.id;
                            if (!mid) {
                                if (!item.dataset.botMid) {
                                    window.__botMsgSeq = (window.__botMsgSeq || 0) + 1;
                                    item.dataset.botMid = "meet_m_" + window.__botMsgSeq;
                                }
                                mid = item.dataset.botMid;
                            }
                            results.push({ id: mid, sender: sender || "Candidate", text });
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
                                            el.dataset.botMid = "leaf_m_" + window.__botMsgSeq;
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
            return self._filter_new_messages(raw_items or [])
        except Exception as exc:
            log.debug("[google_meet] read_new_messages notice: %s", exc)
            return []

    async def has_everyone_else_left(self) -> bool:
        """Check if Google Meet is showing an alone-in-call banner or leave prompt."""
        return await self._any_visible([
            ':has-text("You\'re the only one here")',
            ':has-text("You are the only one here")',
            ':has-text("Everyone else has left")',
            ':has-text("Leave the call?")',
            ':has-text("You\'re on your own")',
            ':has-text("Are you still there?")',
        ], timeout_ms=300)

    async def start_screen_share(self) -> bool:
        clicked = await self._click_first([
            'button[aria-label*="Present now" i]',
            'button[aria-label*="Share screen" i]',
        ], timeout_ms=2500)
        if not clicked:
            return False
        await asyncio.sleep(0.6)
        # On Google Meet, clicking "Present now" opens a menu ("Your entire screen", "A window", "A tab")
        await self._click_first([
            '[role="menuitem"]:has-text("entire screen")',
            'li:has-text("entire screen")',
            'span:has-text("Your entire screen")',
        ], timeout_ms=1500)
        log.info("[google_meet] Full-screen Question Display Present triggered!")
        return True

    async def get_participant_count(self) -> Optional[int]:
        # 1. Direct check on Meet toolbar & header counters/badges
        count = await self._extract_count_from_selectors([
            'button[aria-label*="Show everyone" i]',
            'button[aria-label*="People" i]',
            'button[aria-label*="everyone" i]',
            'button[aria-label*="participant" i]',
            'div[aria-label*="people" i]',
            'div[aria-label*="everyone" i]',
            '.uGOf1d',
            '[data-testid="participant-count"]',
        ])
        if count is not None:
            return count

        # 2. Resilient DOM query: count participant tiles on screen and scan header counters
        try:
            dom_count = await self.page.evaluate("""() => {
                // Count participant video tiles in grid
                const tiles = document.querySelectorAll(
                    '[data-participant-id], [data-requested-participant-id], div[data-allocation-index]'
                );
                if (tiles.length > 0) {
                    const uniqueIds = new Set();
                    tiles.forEach(t => {
                        const pid = t.getAttribute('data-participant-id') || 
                                    t.getAttribute('data-requested-participant-id') || 
                                    t.getAttribute('data-allocation-index');
                        if (pid) uniqueIds.add(pid);
                    });
                    if (uniqueIds.size > 0) return uniqueIds.size;
                    return tiles.length;
                }

                // Look for any badge or counter with numbers in header / toolbar
                const buttons = document.querySelectorAll('button, div[role="button"], span');
                for (const b of buttons) {
                    const aria = (b.getAttribute('aria-label') || '').toLowerCase();
                    if (aria.includes('people') || aria.includes('everyone') || aria.includes('participant')) {
                        const m = aria.match(/\\b(\\d+)\\b/);
                        if (m) return parseInt(m[1], 10);
                        const txt = (b.innerText || '').trim();
                        const m2 = txt.match(/\\b(\\d+)\\b/);
                        if (m2) return parseInt(m2[1], 10);
                    }
                }
                return null;
            }""")
            if dom_count is not None and dom_count >= 1:
                return dom_count
        except Exception:
            pass
        return None

    async def admit_waiting_participants(self) -> bool:
        if await self._click_first([
            'button:has-text("Admit all")',
            'button:has-text("Admit")',
        ], timeout_ms=400):
            log.info("[google_meet] Auto-admitted waiting candidate!")
            return True
        return False

    async def leave(self) -> None:
        await self._click_first([
            'button[aria-label*="Leave call" i]',
            'button[data-testid="leave-call"]',
        ], timeout_ms=2500)
