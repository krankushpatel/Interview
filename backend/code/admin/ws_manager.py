from fastapi import WebSocket, WebSocketDisconnect
from typing import List
import json

class ConnectionManager:
    def __init__(self):
        # Admin ke active websocket connections yahan store honge
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        if websocket not in self.active_connections:
            self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast_live_exams(self, data: dict):
        """Saare connected admins ko latest live exams ka data bhejega"""
        dead_connections = []
        for connection in list(self.active_connections):
            try:
                await connection.send_json(data)
            except Exception:
                dead_connections.append(connection)
        for dead_conn in dead_connections:
            self.disconnect(dead_conn)

admin_ws_manager = ConnectionManager()