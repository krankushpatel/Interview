import asyncio
from fastapi import WebSocket
from typing import Dict, List, Optional

class LiveScreenManager:
    """Manages live screen and camera streaming for admin monitoring across threads and event loops."""
    
    def __init__(self):
        self.screen_viewers: Dict[str, List[WebSocket]] = {}
        self.camera_viewers: Dict[str, List[WebSocket]] = {}
        self.latest_screen_frame: Dict[str, str] = {}
        self.latest_camera_frame: Dict[str, str] = {}
        self._main_loop: Optional[asyncio.AbstractEventLoop] = None

    async def connect_screen_viewer(self, websocket: WebSocket, username: str):
        """Admin connects to view student's screen (always called on main FastAPI event loop)."""
        await websocket.accept()
        try:
            self._main_loop = asyncio.get_running_loop()
        except RuntimeError:
            pass
        key = (username or "").strip().lower()
        if key not in self.screen_viewers:
            self.screen_viewers[key] = []
        self.screen_viewers[key].append(websocket)
        if key in self.latest_screen_frame:
            await websocket.send_text(self.latest_screen_frame[key])
        print(f"[LIVE] Admin viewing {username}'s screen")

    def disconnect_screen_viewer(self, websocket: WebSocket, username: str):
        """Admin disconnects from viewing student's screen"""
        key = (username or "").strip().lower()
        if key in self.screen_viewers and websocket in self.screen_viewers[key]:
            self.screen_viewers[key].remove(websocket)
            print(f"[LIVE] Admin stopped viewing {username}'s screen")

    async def _send_to_viewers(self, viewers: List[WebSocket], frame_data: str, is_camera: bool, key: str):
        disconnected = []
        for viewer_ws in list(viewers):
            try:
                await viewer_ws.send_text(frame_data)
            except Exception as e:
                print(f"[LIVE] Frame send error to viewer: {e}")
                disconnected.append(viewer_ws)
        for ws in disconnected:
            if is_camera:
                self.disconnect_camera_viewer(ws, key)
            else:
                self.disconnect_screen_viewer(ws, key)

    async def broadcast_screen_frame(self, username: str, frame_data: str):
        """Broadcast screen frame to all admins viewing this student (thread-safe)."""
        key = (username or "").strip().lower()
        self.latest_screen_frame[key] = frame_data
        viewers = self.screen_viewers.get(key)
        if viewers:
            try:
                cur_loop = asyncio.get_running_loop()
            except RuntimeError:
                cur_loop = None

            target_loop = self._main_loop
            if target_loop and target_loop.is_running() and cur_loop != target_loop:
                asyncio.run_coroutine_threadsafe(
                    self._send_to_viewers(viewers, frame_data, False, key),
                    target_loop
                )
            elif cur_loop and (not target_loop or cur_loop == target_loop):
                await self._send_to_viewers(viewers, frame_data, False, key)

    async def connect_camera_viewer(self, websocket: WebSocket, username: str):
        """Admin connects to view student's camera (always called on main FastAPI event loop)."""
        await websocket.accept()
        try:
            self._main_loop = asyncio.get_running_loop()
        except RuntimeError:
            pass
        key = (username or "").strip().lower()
        if key not in self.camera_viewers:
            self.camera_viewers[key] = []
        self.camera_viewers[key].append(websocket)
        if key in self.latest_camera_frame:
            await websocket.send_text(self.latest_camera_frame[key])
        print(f"[LIVE] Admin viewing {username}'s camera")

    def disconnect_camera_viewer(self, websocket: WebSocket, username: str):
        """Admin disconnects from viewing student's camera"""
        key = (username or "").strip().lower()
        if key in self.camera_viewers and websocket in self.camera_viewers[key]:
            self.camera_viewers[key].remove(websocket)
            print(f"[LIVE] Admin stopped viewing {username}'s camera")

    async def broadcast_camera_frame(self, username: str, frame_data: str):
        """Broadcast camera frame to all admins viewing this student (thread-safe)."""
        key = (username or "").strip().lower()
        self.latest_camera_frame[key] = frame_data
        viewers = self.camera_viewers.get(key)
        if viewers:
            try:
                cur_loop = asyncio.get_running_loop()
            except RuntimeError:
                cur_loop = None

            target_loop = self._main_loop
            if target_loop and target_loop.is_running() and cur_loop != target_loop:
                asyncio.run_coroutine_threadsafe(
                    self._send_to_viewers(viewers, frame_data, True, key),
                    target_loop
                )
            elif cur_loop and (not target_loop or cur_loop == target_loop):
                await self._send_to_viewers(viewers, frame_data, True, key)


# Shared singleton instance for in-process WebSocket broadcasting
screen_manager = LiveScreenManager()
