from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from code.recording.screen_manager import LiveScreenManager
import os
import aiohttp

router = APIRouter()
screen_manager = LiveScreenManager()

@router.websocket("/ws/stream-screen/{username}")
async def stream_screen(websocket: WebSocket, username: str):
    """Student sends screen frames"""
    await websocket.accept()
    print(f"[LIVE] {username} started streaming screen")
    try:
        while True:
            frame_data = await websocket.receive_text()
            await screen_manager.broadcast_screen_frame(username, frame_data)
    except WebSocketDisconnect:
        print(f"[LIVE] {username} stopped streaming screen")

@router.websocket("/ws/stream-camera/{username}")
async def stream_camera(websocket: WebSocket, username: str):
    """Student sends camera frames"""
    await websocket.accept()
    print(f"[LIVE] {username} started streaming camera")
    try:
        while True:
            frame_data = await websocket.receive_text()
            await screen_manager.broadcast_camera_frame(username, frame_data)
    except WebSocketDisconnect:
        print(f"[LIVE] {username} stopped streaming camera")

@router.websocket("/ws/view-screen/{username}")
async def view_screen(websocket: WebSocket, username: str):
    """Admin views student's screen"""
    await screen_manager.connect_screen_viewer(websocket, username)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        screen_manager.disconnect_screen_viewer(websocket, username)

@router.websocket("/ws/view-camera/{username}")
async def view_camera(websocket: WebSocket, username: str):
    """Admin views student's camera"""
    await screen_manager.connect_camera_viewer(websocket, username)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        screen_manager.disconnect_camera_viewer(websocket, username)

@router.websocket("/ws/deepgram")
async def deepgram_proxy(websocket: WebSocket):
    """Proxy WebSocket connection to Deepgram API"""
    await websocket.accept()
    session = None
    deepgram_ws = None
    try:
        DEEPGRAM_API_KEY = os.getenv("DEEPGRAM_API_KEY")
        DEEPGRAM_MODEL = os.getenv("DEEPGRAM_MODEL", "nova-2")
        if not DEEPGRAM_API_KEY:
            print("[Deepgram] ERROR: API key missing")
            await websocket.send_json({"error": "Deepgram API key not configured"})
            await websocket.close(code=1011, reason="API key missing")
            return

        deepgram_url = (
            f"wss://api.deepgram.com/v1/listen"
            f"?model={DEEPGRAM_MODEL}"
            f"&language=en-IN"
            f"&interim_results=true"
            f"&endpointing=true"
            f"&punctuate=true"
            f"&diarize=true"
        )
        session = aiohttp.ClientSession()
        deepgram_ws = await session.ws_connect(
            deepgram_url,
            headers={"Authorization": f"Token {DEEPGRAM_API_KEY}"}
        )
        print(f"[Deepgram] Connected to Deepgram API with {DEEPGRAM_MODEL}")

        async def forward_to_client():
            async for msg in deepgram_ws:
                if msg.type == aiohttp.WSMsgType.TEXT:
                    await websocket.send_text(msg.data)
                elif msg.type == aiohttp.WSMsgType.ERROR:
                    print("[Deepgram] Connection error")

        async def forward_to_deepgram():
            while True:
                msg = await websocket.receive()
                if msg.get("type") == "websocket.disconnect":
                    break
                text_data = msg.get("text")
                if text_data:
                    try:
                        data = json.loads(text_data)
                        if data.get("type") in ("KeepAlive", "keepalive"):
                            if deepgram_ws and not deepgram_ws.closed:
                                await deepgram_ws.send_json({"type": "KeepAlive"})
                    except Exception:
                        pass
                    continue
                bytes_data = msg.get("bytes")
                if bytes_data and deepgram_ws and not deepgram_ws.closed:
                    await deepgram_ws.send_bytes(bytes_data)

        import asyncio
        await asyncio.gather(forward_to_client(), forward_to_deepgram())

    except Exception as e:
        print(f"[Deepgram] Proxy error: {e}")
        await websocket.send_json({"error": str(e)})
    finally:
        if deepgram_ws:
            await deepgram_ws.close()
        if session:
            await session.close()
        try:
            await websocket.close()
        except:
            pass