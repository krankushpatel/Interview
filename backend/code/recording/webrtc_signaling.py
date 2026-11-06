import json
from typing import Dict, List, Optional
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter()

class WebRtcSignalingManager:
    """
    Manages WebRTC Signaling (SDP Offer/Answer & ICE Candidates)
    between Students and Admin Invigilators with reliable renegotiation.
    """
    def __init__(self):
        # student_username -> WebSocket
        self.students: Dict[str, WebSocket] = {}
        # student_username -> List[WebSocket] (allows multiple admins/inspectors)
        self.admins: Dict[str, List[WebSocket]] = {}

    async def register_student(self, username: str, websocket: WebSocket):
        await websocket.accept()
        self.students[username] = websocket
        print(f"[WebRTC Signaling] Student connected: {username}")
        # Notify any connected admins that student is online
        await self._notify_admins(username, {
            "type": "peer-status",
            "role": "student",
            "status": "online",
            "username": username
        })
        # If an admin is already waiting, trigger student to send offer
        if username in self.admins and self.admins[username]:
            try:
                await websocket.send_json({
                    "type": "admin-joined",
                    "role": "admin",
                    "username": username
                })
            except Exception:
                pass

    def unregister_student(self, username: str, websocket: WebSocket):
        if username in self.students and self.students[username] == websocket:
            del self.students[username]
            print(f"[WebRTC Signaling] Student disconnected: {username}")

    async def register_admin(self, username: str, websocket: WebSocket):
        await websocket.accept()
        if username not in self.admins:
            self.admins[username] = []
        self.admins[username].append(websocket)
        print(f"[WebRTC Signaling] Admin connected for student: {username}")
        
        is_student_online = username in self.students
        # Inform admin of student status
        await websocket.send_json({
            "type": "peer-status",
            "role": "student",
            "status": "online" if is_student_online else "offline",
            "username": username
        })

        # CRITICAL FIX: Inform student that admin has joined so student generates a fresh offer!
        if is_student_online:
            try:
                await self.students[username].send_json({
                    "type": "admin-joined",
                    "role": "admin",
                    "username": username
                })
                print(f"[WebRTC Signaling] Sent admin-joined trigger to student: {username}")
            except Exception as e:
                print(f"[WebRTC Signaling] Failed to notify student {username} of admin arrival: {e}")

    def unregister_admin(self, username: str, websocket: WebSocket):
        if username in self.admins and websocket in self.admins[username]:
            self.admins[username].remove(websocket)
            if not self.admins[username]:
                del self.admins[username]
                # Notify student that all admins left
                if username in self.students:
                    try:
                        import asyncio
                        asyncio.create_task(self.students[username].send_json({
                            "type": "admin-left",
                            "role": "admin",
                            "username": username
                        }))
                    except Exception:
                        pass
            print(f"[WebRTC Signaling] Admin disconnected for student: {username}")

    async def relay_from_student(self, username: str, data: dict):
        """Relay message from student to listening admin(s)"""
        if username in self.admins:
            disconnected = []
            for admin_ws in self.admins[username]:
                try:
                    await admin_ws.send_json(data)
                except Exception:
                    disconnected.append(admin_ws)
            for ws in disconnected:
                self.unregister_admin(username, ws)

    async def relay_from_admin(self, username: str, data: dict):
        """Relay message from admin to the student"""
        if username in self.students:
            try:
                await self.students[username].send_json(data)
            except Exception:
                pass

    async def _notify_admins(self, username: str, data: dict):
        if username in self.admins:
            disconnected = []
            for admin_ws in self.admins[username]:
                try:
                    await admin_ws.send_json(data)
                except Exception:
                    disconnected.append(admin_ws)
            for ws in disconnected:
                self.unregister_admin(username, ws)


signaling_manager = WebRtcSignalingManager()


@router.websocket("/ws/webrtc/student/{username}")
async def webrtc_student_signaling(websocket: WebSocket, username: str):
    """
    WebSocket endpoint for Student WebRTC signaling.
    Receives SDP offer, ICE candidates, and forwards to Admin.
    """
    await signaling_manager.register_student(username, websocket)
    try:
        while True:
            text = await websocket.receive_text()
            try:
                data = json.loads(text)
            except Exception:
                continue

            msg_type = data.get("type")
            if msg_type == "ping":
                await websocket.send_json({"type": "pong"})
                continue

            # Forward offer, candidate, stream-ready to admin
            await signaling_manager.relay_from_student(username, data)
    except WebSocketDisconnect:
        signaling_manager.unregister_student(username, websocket)
        await signaling_manager.relay_from_student(username, {
            "type": "peer-status",
            "role": "student",
            "status": "offline",
            "username": username
        })
    except Exception as e:
        print(f"[WebRTC Error] Student {username} signaling error: {e}")
        signaling_manager.unregister_student(username, websocket)


@router.websocket("/ws/webrtc/admin/{username}")
async def webrtc_admin_signaling(websocket: WebSocket, username: str):
    """
    WebSocket endpoint for Admin WebRTC signaling.
    Receives SDP answer, ICE candidates, and forwards to Student.
    """
    await signaling_manager.register_admin(username, websocket)
    try:
        while True:
            text = await websocket.receive_text()
            try:
                data = json.loads(text)
            except Exception:
                continue

            msg_type = data.get("type")
            if msg_type == "ping":
                await websocket.send_json({"type": "pong"})
                continue

            # Forward answer, candidate, request-offer to student
            await signaling_manager.relay_from_admin(username, data)
    except WebSocketDisconnect:
        signaling_manager.unregister_admin(username, websocket)
    except Exception as e:
        print(f"[WebRTC Error] Admin viewing {username} signaling error: {e}")
        signaling_manager.unregister_admin(username, websocket)
