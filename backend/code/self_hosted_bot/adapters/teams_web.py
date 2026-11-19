"""Microsoft Teams Web Adapter (teams.microsoft.com & teams.live.com) for Self-Hosted Bot."""
from __future__ import annotations

import asyncio
import logging
from typing import List, Optional

from .base import BasePlatformAdapter, ChatMessage

log = logging.getLogger("self_hosted_bot.adapters.teams")


class TeamsWebAdapter(BasePlatformAdapter):
    platform_name = "teams"

    async def join(
        self,
        meeting_url: str,
        bot_name: Optional[str] = None,
        lobby_timeout_sec: int = 180,
    ) -> bool:
        self.bot_name = bot_name or self.worker.config.bot_name
        log.info("[teams] Navigating to Microsoft Teams: %s", meeting_url)
        await self.worker.open_url(meeting_url)
        await asyncio.sleep(2.5)

        # Handle "How do you want to join your Teams meeting?" interstitial
        await self._click_first([
            'button[data-tid="joinOnWeb"]',
            'button:has-text("Continue on this browser")',
            'a:has-text("Continue on this browser")',
            'button:has-text("Join on the web instead")',
            'a:has-text("Join on the web instead")',
        ], timeout_ms=4500)
        await asyncio.sleep(2.0)

        # Dismiss cookie banners if shown
        await self._click_first([
            'button:has-text("Accept")',
            'button:has-text("Continue without audio or video")',  # only if forced
        ], timeout_ms=1000)

        # Fill guest display name
        await self._fill_first([
            'input[data-tid="prejoin-display-name-input"]',
            'input[placeholder*="Type your name" i]',
            'input[aria-label*="Type your name" i]',
            'input[type="text"]',
        ], self.bot_name, timeout_ms=5000)

        # Ensure Computer audio is selected if radio option exists
        await self._click_first([
            'label:has-text("Computer audio")',
            'input[data-tid="prejoin-audio-computer-radio"]',
        ], timeout_ms=1200)

        # Click "Join now"
        await self._click_first([
            'button[data-tid="prejoin-join-button"]',
            'button:has-text("Join now")',
            'button[aria-label*="Join now" i]',
        ], timeout_ms=5000)

        # Wait through lobby until admitted into live call
        joined = await self._wait_for_call_entry(timeout_sec=lobby_timeout_sec)
        if not joined:
            return False

        await asyncio.sleep(1.5)
        await self.open_chat()
        return True

    async def is_in_call(self) -> bool:
        return await self._any_visible([
            '#hangup-button',
            'button[data-tid="hangup-main-btn"]',
            'button[aria-label*="Leave" i]',
            '#chat-button',
            'button[data-tid="chat-button"]',
            'button[data-testid="leave-call"]',
        ], timeout_ms=700)

    async def open_chat(self) -> bool:
        if await self._any_visible([
            'div[contenteditable="true"][data-tid="ckeditor"]',
            'div[contenteditable="true"][role="textbox"]',
            'textarea[placeholder*="Type a message" i]',
            '[data-testid="chat-input"]',
        ], timeout_ms=600):
            return True

        clicked = await self._click_first([
            '#chat-button',
            'button[data-tid="chat-button"]',
            'button[aria-label*="Chat" i]',
            'button:has-text("Chat")',
        ], timeout_ms=2500)
        if clicked:
            await asyncio.sleep(0.8)
        return clicked

    async def send_chat(self, text: str) -> bool:
        await self.open_chat()
        return await self._type_and_send(
            input_selectors=[
                'div[contenteditable="true"][data-tid="ckeditor"]',
                'div[contenteditable="true"][aria-label*="Type a message" i]',
                'div[contenteditable="true"][role="textbox"]',
                'textarea[placeholder*="Type a message" i]',
                '[data-testid="chat-input"]',
            ],
            text=text,
            send_button_selectors=[
                'button[data-tid="newMessageCommands-send"]',
                'button[aria-label="Send" i]',
                'button[name="send"]',
                'button[data-testid="send-chat"]',
            ],
        )

    async def read_new_messages(self) -> List[ChatMessage]:
        try:
            raw_items = await self.page.evaluate(
                """() => {
                    const results = [];
                    const nodes = document.querySelectorAll(
                        '[data-tid="chat-pane-message"], [data-tid="chat-pane-item"], [data-testid="chat-message"]'
                    );
                    nodes.forEach((node) => {
                        const senderEl = node.querySelector(
                            '[data-tid="message-author-name"], [data-testid="chat-sender"]'
                        );
                        const bodyEl = node.querySelector(
                            '[data-tid="messageBodyContent"], [data-testid="chat-text"]'
                        );
                        const text = (bodyEl ? bodyEl.innerText : node.innerText || "").trim();
                        const sender = (senderEl ? senderEl.innerText : "").trim();
                        if (text) {
                            results.push({
                                id: node.getAttribute("data-mid") || node.id || "",
                                sender,
                                text
                            });
                        }
                    });
                    return results;
                }"""
            )
            return self._filter_new_messages(raw_items or [])
        except Exception as exc:
            log.debug("[teams] read_new_messages notice: %s", exc)
            return []

    async def start_screen_share(self) -> bool:
        return await self._click_first([
            '#share-button',
            'button[data-tid="share-button"]',
            'button[aria-label*="Share" i]',
        ], timeout_ms=2000)

    async def get_participant_count(self) -> Optional[int]:
        return await self._extract_count_from_selectors([
            '#roster-button [data-tid*="count"]',
            '#roster-button',
            'button[data-tid="roster-button"]',
            'button[aria-label*="People" i]',
            '[data-testid="participant-count"]',
        ])

    async def admit_waiting_participants(self) -> bool:
        if await self._click_first([
            'button[data-tid="lobby-admit-all-btn"]',
            'button:has-text("Admit all")',
            'button:has-text("Admit")',
        ], timeout_ms=400):
            log.info("[teams] Auto-admitted waiting candidate from lobby!")
            return True
        return False

    async def leave(self) -> None:
        await self._click_first([
            '#hangup-button',
            'button[data-tid="hangup-main-btn"]',
            'button[aria-label*="Leave" i]',
            'button[data-testid="leave-call"]',
        ], timeout_ms=2500)
