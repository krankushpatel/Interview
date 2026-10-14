from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
import os
from dotenv import load_dotenv
from code.audio.vad_processor import VADProcessor
from code.settings_route.routes import router as settings_router

os.environ["TORCH_USE_NNPACK"] = "0"   # Disable NNPACK
os.environ["TORCH_ENABLE_ONEDNN_OPT"] = "0"  # Optional: disable oneDNN warnings

from pathlib import Path
BACKEND_DIR = Path(__file__).resolve().parent
load_dotenv(BACKEND_DIR / ".env")
load_dotenv()

gemini_key = (os.getenv("GEMINI_API_KEY") or "").strip()
gemini_model = (os.getenv("GEMINI_MODEL") or "").strip()
deepgram_key = (os.getenv("DEEPGRAM_API_KEY") or "").strip()
openrouter_key = (os.getenv("OPENROUTER_API_KEY") or "").strip()

print("\n" + "=" * 70)
print("🔑 [AI INTERVIEW PLATFORM - STARTUP CONFIG CHECK]")
if not gemini_key:
    print("❌ GEMINI_API_KEY: MISSING (.env me set nahi hai)")
elif not gemini_key.startswith("AIzaSy") and not os.getenv("GEMINI_BASE_URL"):
    print(f"⚠️ GEMINI_API_KEY: '{gemini_key[:8]}...' (Length: {len(gemini_key)})")
    print("   WARNING: Google Gemini keys start with 'AIzaSy'. Check your .env key!")
else:
    print(f"✅ GEMINI_API_KEY: Valid format ('{gemini_key[:8]}...', model: {gemini_model or 'default'})")

if not deepgram_key:
    print("❌ DEEPGRAM_API_KEY: MISSING (.env me set nahi hai - /ws/stt-stream will reject)")
else:
    print(f"✅ DEEPGRAM_API_KEY: Present ('{deepgram_key[:8]}...')")

if not openrouter_key:
    print("ℹ️ OPENROUTER_API_KEY: Not configured")
else:
    print(f"✅ OPENROUTER_API_KEY: Present ('{openrouter_key[:8]}...') [Backup fallback]")
print("=" * 70 + "\n")

# ✅ Import routes
from fastapi.staticfiles import StaticFiles
from code.config.settings import UPLOADS_DIR
from code.auth.routes import router as auth_router
from code.auth.dependencies import get_current_admin   # 🔐 JWT dependency
from code.questions.routes import router as questions_router
from code.submissions.routes import router as submissions_router
from code.evaluation.routes import router as evaluation_router
from code.proctoring.routes import router as proctoring_router
from code.recording.routes import router as recording_router
from code.results.routes import router as results_router
from code.admin.routes import router as admin_router
from code.student.routes import router as student_router
from code.timetable.routes import router as timetable_router
from code.categories.routes import router as categories_router
from code.audio.routes import router as audio_router
from code.core.data_manager import initialize_data
from code.batches.routes import router as batches_router
from code.settings_route.routes import router as settings_router
from code.services.dipstick_auto_sync import auto_sync_dipstick_questions
from code.classes.routes import router as classes_router
import asyncio
from fastapi import WebSocket, WebSocketDisconnect
from code.admin.ws_manager import admin_ws_manager
from code.admin.monitoring import get_live_exams

# Initialize FastAPI app
app = FastAPI(title="AI Interview Platform", version="5.0")
app.mount("/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")
app.mount("/static", StaticFiles(directory="static"), name="static")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def startup_event():
    # 1. Initialize local data
    initialize_data()
    
    # 2. Preload Silero VAD model
    print("[SYSTEM] Preloading Silero VAD model into RAM...")
    VADProcessor()
    
    # 3. ✅ NEW: Auto-sync Dipstick questions
    print("[SYSTEM] 🔄 Auto-syncing questions from Dipstick...")
    try:
        from code.services.dipstick_auto_sync import auto_sync_dipstick_questions
        success = await auto_sync_dipstick_questions()
        if success:
            print("[SYSTEM] ✅ Dipstick questions synced successfully")
        else:
            print("[SYSTEM] ⚠️ Dipstick sync failed, will use local questions.json")
    except Exception as e:
        print(f"[SYSTEM] ❌ Dipstick auto-sync error: {e}")
        print("[SYSTEM] ⚠️ Continuing with local questions.json")

# ✅ Public routes (no auth required)
app.include_router(auth_router, prefix="/auth", tags=["Auth"])
app.include_router(questions_router, prefix="/questions", tags=["Questions"])
app.include_router(submissions_router, prefix="/submissions", tags=["Submissions"])
app.include_router(evaluation_router, prefix="/evaluation", tags=["Evaluation"])
app.include_router(proctoring_router, prefix="/proctoring", tags=["Proctoring"])
app.include_router(recording_router, prefix="/recording", tags=["Recording"])
app.include_router(results_router, prefix="/results", tags=["Results"])
app.include_router(student_router, prefix="/student", tags=["Student"])
app.include_router(timetable_router, prefix="/admin/timetable", tags=["Admin Timetable"])
app.include_router(categories_router, prefix="/categories", tags=["Categories"])
app.include_router(audio_router, tags=["Audio"])
app.include_router(batches_router, prefix="/admin/batches", tags=["Batches"], dependencies=[Depends(get_current_admin)])
app.include_router(settings_router, prefix="/exam-settings", tags=["Settings"])
app.include_router(classes_router, prefix="/classes", tags=["Classes"])

# 🔐 PROTECTED: All admin routes require valid JWT token
app.include_router(
    admin_router,
    prefix="/admin",
    tags=["Admin"],
    dependencies=[Depends(get_current_admin)]   # <-- JWT protection
)

# Health check (public)
@app.get("/health")
async def health():
    from code.config.settings import WHISPER_AVAILABLE, AI_AVAILABLE, OPENROUTER_AVAILABLE
    from code.core.data_manager import get_loaded_data
    data = get_loaded_data()
    return {
        "status": "ok",
        "questions_loaded": len(data["questions"]),
        "users_loaded": len(data["users"]),
        "whisper": WHISPER_AVAILABLE,
        "ai_evaluation": AI_AVAILABLE or OPENROUTER_AVAILABLE,
    }

@app.websocket("/ws/admin/live-exams")
# @app.websocket("/admin/ws/admin/live-exams")
async def websocket_live_exams(websocket: WebSocket, token: str = None):
    # Agar bina token ke koi connect kare, toh connection reject kar do
    if not token:
        await websocket.close(code=1008)
        return
        
    await admin_ws_manager.connect(websocket)
    try:
        # Connection bante hi initial data bhej do
        initial_data = get_live_exams()
        await websocket.send_json(initial_data)
        
        while True:
            # Connection zinda rakhne ke liye wait karo
            await websocket.receive_text()
    except WebSocketDisconnect:
        admin_ws_manager.disconnect(websocket)
    except Exception:
        admin_ws_manager.disconnect(websocket)