from fastapi import WebSocket
from typing import Dict, List

class LiveScreenManager:
    """Manages live screen and camera streaming for admin monitoring"""
    
    def __init__(self):
        self.screen_viewers: Dict[str, List[WebSocket]] = {}
        self.camera_viewers: Dict[str, List[WebSocket]] = {}
        self.latest_screen_frame: Dict[str, str] = {}
        self.latest_camera_frame: Dict[str, str] = {}

    async def connect_screen_viewer(self, websocket: WebSocket, username: str):
        """Admin connects to view student's screen"""
        await websocket.accept()
        if username not in self.screen_viewers:
            self.screen_viewers[username] = []
        self.screen_viewers[username].append(websocket)
        if username in self.latest_screen_frame:
            await websocket.send_text(self.latest_screen_frame[username])
        print(f"[LIVE] Admin viewing {username}'s screen")

    def disconnect_screen_viewer(self, websocket: WebSocket, username: str):
        """Admin disconnects from viewing student's screen"""
        if username in self.screen_viewers and websocket in self.screen_viewers[username]:
            self.screen_viewers[username].remove(websocket)
            print(f"[LIVE] Admin stopped viewing {username}'s screen")

    async def broadcast_screen_frame(self, username: str, frame_data: str):
        """Broadcast screen frame to all admins viewing this student"""
        self.latest_screen_frame[username] = frame_data
        if username in self.screen_viewers and self.screen_viewers[username]:
            disconnected = []
            for viewer_ws in self.screen_viewers[username]:
                try:
                    await viewer_ws.send_text(frame_data)
                except Exception:
                    disconnected.append(viewer_ws)
            for ws in disconnected:
                self.disconnect_screen_viewer(ws, username)

    async def connect_camera_viewer(self, websocket: WebSocket, username: str):
        """Admin connects to view student's camera"""
        await websocket.accept()
        if username not in self.camera_viewers:
            self.camera_viewers[username] = []
        self.camera_viewers[username].append(websocket)
        if username in self.latest_camera_frame:
            await websocket.send_text(self.latest_camera_frame[username])
        print(f"[LIVE] Admin viewing {username}'s camera")

    def disconnect_camera_viewer(self, websocket: WebSocket, username: str):
        """Admin disconnects from viewing student's camera"""
        if username in self.camera_viewers and websocket in self.camera_viewers[username]:
            self.camera_viewers[username].remove(websocket)
            print(f"[LIVE] Admin stopped viewing {username}'s camera")

    async def broadcast_camera_frame(self, username: str, frame_data: str):
        """Broadcast camera frame to all admins viewing this student"""
        self.latest_camera_frame[username] = frame_data
        if username in self.camera_viewers and self.camera_viewers[username]:
            disconnected = []
            for viewer_ws in self.camera_viewers[username]:
                try:
                    await viewer_ws.send_text(frame_data)
                except Exception:
                    disconnected.append(viewer_ws)
            for ws in disconnected:
                self.disconnect_camera_viewer(ws, username)