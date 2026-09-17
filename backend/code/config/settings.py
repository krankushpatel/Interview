import os
from pathlib import Path
from dotenv import load_dotenv

# ✅ Get parent directory (backend directory)
BASE_DIR = Path(__file__).parent.parent.parent  # code/config/settings.py -> backend/
load_dotenv(BASE_DIR / ".env")
load_dotenv()

# ✅ All paths point to ROOT level
UPLOADS_DIR = BASE_DIR / "uploads"
DATA_DIR = BASE_DIR / "data"
TEMPLATES_DIR = BASE_DIR / "templates"

# JSON files in root
USERS_FILE = DATA_DIR / "users.json"
QUESTIONS_FILE = DATA_DIR / "questions.json"

# JSON files in data/
SUBMISSIONS_FILE = DATA_DIR / "submissions.json"
EXAM_RECORDINGS_FILE = DATA_DIR / "exam_recordings.json"
SESSION_ANSWERS_FILE = DATA_DIR / "session_answers.json"
SESSION_PROCTORING_FILE = DATA_DIR / "session_proctoring.json"
RESULTS_STORE_FILE = DATA_DIR / "results_store.json"
SCREEN_RECORDINGS_FILE = DATA_DIR / "screen_recordings.json"
SESSION_LOGS_FILE = DATA_DIR / "session_logs.json"
EXAM_SESSIONS_FILE = DATA_DIR / "exam_sessions.json"
CATEGORIES_FILE = DATA_DIR / "categories.json"
PROGRESSIVE_SCORES_FILE = DATA_DIR / "progressive_scores.json"

# Create directories
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
DATA_DIR.mkdir(exist_ok=True)
TEMPLATES_DIR.mkdir(exist_ok=True)

# --- MONGODB CONFIGURATION ---
MONGO_URI = os.getenv("MONGO_URI") or os.getenv("MONGO_URL", "")
MONGO_URL = MONGO_URI
MONGO_DB_NAME = os.getenv("MONGO_DB_NAME", "interview_platform")

# Whisper configuration
try:
    import whisper as _whisper
    _WHISPER_MODEL_NAME = os.getenv("WHISPER_MODEL", "base")
    _WHISPER_MODEL = _whisper.load_model(_WHISPER_MODEL_NAME)
    WHISPER_AVAILABLE = True
except ImportError:
    WHISPER_AVAILABLE = False
    _WHISPER_MODEL = None

# Anthropic Claude configuration
try:
    import anthropic as _anthropic
    _ANTHROPIC_KEY = os.getenv("ANTHROPIC_API_KEY", "")
    _AI_CLIENT = _anthropic.Anthropic(api_key=_ANTHROPIC_KEY) if _ANTHROPIC_KEY else None
    AI_AVAILABLE = bool(_ANTHROPIC_KEY)
except ImportError:
    _AI_CLIENT = None
    AI_AVAILABLE = False

# OpenRouter configuration
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
OPENROUTER_MODEL = os.getenv("OPENROUTER_MODEL", "")
OPENROUTER_AVAILABLE = bool(OPENROUTER_API_KEY and OPENROUTER_MODEL)

# Deepgram — PRIMARY STT engine. Key MUST come from .env 
DEEPGRAM_API_KEY = os.getenv("DEEPGRAM_API_KEY", "")
if not DEEPGRAM_API_KEY:
    print("[CONFIG] ⚠️  DEEPGRAM_API_KEY not set — STT will fall back to browser webkitSpeechRecognition")
DEEPGRAM_AVAILABLE = bool(DEEPGRAM_API_KEY)

# Decision thresholds
EXAM_PASS_SCORE_THRESHOLD = 55
EXAM_EXCELLENT_SCORE_THRESHOLD = 70