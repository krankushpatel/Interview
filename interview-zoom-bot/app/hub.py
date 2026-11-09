"""WebSocket fan-out for the admin live view."""
from __future__ import annotations

import logging
from typing import Any

from fastapi import WebSocket

log = logging.getLogger("hub")


class Hub:
    def __init__(self) -> None:
        self._clients: dict[WebSocket, str | None] = {}
        self.listener = None

    async def connect(self, ws: WebSocket, interview_id: str | None = None) -> None:
        await ws.accept()
        self._clients[ws] = interview_id or None

    def disconnect(self, ws: WebSocket) -> None:
        self._clients.pop(ws, None)

    async def publish(self, interview_id: str, payload: dict[str, Any]) -> None:
        msg = {"interview_id": interview_id, **payload}
        if self.listener:
            try:
                import asyncio
                res = self.listener(interview_id, payload)
                if asyncio.iscoroutine(res):
                    asyncio.create_task(res)
            except Exception:
                pass
        dead: list[WebSocket] = []
        for ws, flt in list(self._clients.items()):
            if flt and flt != interview_id:
                continue
            try:
                await ws.send_json(msg)
            except Exception:  # client went away
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)
