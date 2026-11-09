"""Settings for Zoom Bot, read from environment / backend .env."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from dotenv import load_dotenv

# Ensure backend .env is loaded
BACKEND_DIR = Path(__file__).resolve().parent.parent.parent
load_dotenv(BACKEND_DIR / ".env")


def _bool(name: str, default: bool) -> bool:
    v = os.getenv(name)
    if v is None or v.strip() == "":
        return default
    return v.strip().lower() in ("1", "true", "yes", "on")


def _int(name: str, default: int) -> int:
    v = os.getenv(name)
    try:
        return int(v) if v not in (None, "") else default
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    recall_api_key: str
    recall_region: str
    public_base_url: str
    webhook_token: str
    admin_key: str
    mock_mode: bool
    db_path: str
    bot_name: str
    default_time_limit_sec: int
    warn_before_sec: int
    silence_timeout_sec: int
    chat_mode: str
    auto_leave: bool
    deepgram_model: str
    deepgram_language: str
    deepgram_interim: bool
    perfect_diarization: bool
    zoom_obf_token_url: str
    zoom_zak_url: str


def load_settings() -> Settings:
    key = os.getenv("RECALL_API_KEY", "").strip()
    default_db = str(BACKEND_DIR / "data" / "zoom_bot_interviews.db")
    return Settings(
        recall_api_key=key,
        recall_region=os.getenv("RECALL_REGION", "us-west-2").strip(),
        public_base_url=os.getenv("PUBLIC_BASE_URL", "").strip().rstrip("/"),
        webhook_token=os.getenv("WEBHOOK_TOKEN", "dev-webhook-token").strip(),
        admin_key=os.getenv("ADMIN_KEY", "").strip(),
        mock_mode=_bool("MOCK_MODE", default=(key == "")),
        db_path=os.getenv("DB_PATH", default_db),
        bot_name=os.getenv("BOT_NAME", "Interviewer").strip(),
        default_time_limit_sec=_int("DEFAULT_TIME_LIMIT_SEC", 300),
        warn_before_sec=_int("WARN_BEFORE_SEC", 60),
        silence_timeout_sec=_int("SILENCE_TIMEOUT_SEC", 35),
        chat_mode=os.getenv("CHAT_MODE", "everyone").strip().lower(),
        auto_leave=_bool("AUTO_LEAVE", True),
        deepgram_model=os.getenv("DEEPGRAM_MODEL", "nova-3").strip(),
        deepgram_language=os.getenv("DEEPGRAM_LANGUAGE", "multi").strip(),
        deepgram_interim=_bool("DEEPGRAM_INTERIM", True),
        perfect_diarization=_bool("PERFECT_DIARIZATION", False),
        zoom_obf_token_url=os.getenv("ZOOM_OBF_TOKEN_URL", "").strip(),
        zoom_zak_url=os.getenv("ZOOM_ZAK_URL", "").strip(),
    )
