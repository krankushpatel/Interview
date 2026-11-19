"""Configuration for the 100% Free Self-Hosted AI Interviewer Bot."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

# Ensure backend/.env is loaded if present
_BACKEND_DIR = Path(__file__).resolve().parents[2]
_ENV_PATH = _BACKEND_DIR / ".env"
if _ENV_PATH.exists():
    load_dotenv(_ENV_PATH, override=False)


def _env_bool(key: str, default: bool) -> bool:
    val = os.getenv(key, "").strip().lower()
    if not val:
        return default
    return val in ("1", "true", "yes", "on")


@dataclass
class SelfHostedBotConfig:
    bot_name: str = "Interviewer"
    brand_title: str = "Eklakhya Interview Panel"
    headless: bool = True
    browser_channel: str = "chrome"  # chrome | msedge | chromium
    canvas_width: int = 1280
    canvas_height: int = 720
    canvas_fps: int = 15
    default_time_limit_sec: int = 300
    warn_before_sec: int = 60
    silence_timeout_sec: int = 35
    lobby_wait_timeout_sec: int = 180
    candidate_wait_timeout_sec: int = 300
    candidate_settle_sec: float = 3.0
    ready_buffer_sec: int = 15
    stt_provider: str = "deepgram"  # deepgram | local_whisper
    whisper_model: str = "base"
    audio_dir: Path = _BACKEND_DIR / "uploads" / "bot_audio"
    profile_dir: Path = _BACKEND_DIR / "data" / "bot_chrome_profile"
    use_persistent_profile: bool = False


def load_bot_config() -> SelfHostedBotConfig:
    audio_dir = Path(os.getenv("SELF_HOSTED_BOT_AUDIO_DIR", str(_BACKEND_DIR / "uploads" / "bot_audio")))
    profile_dir = Path(os.getenv("SELF_HOSTED_BOT_PROFILE_DIR", str(_BACKEND_DIR / "data" / "bot_chrome_profile")))
    audio_dir.mkdir(parents=True, exist_ok=True)
    profile_dir.mkdir(parents=True, exist_ok=True)

    return SelfHostedBotConfig(
        bot_name=os.getenv("BOT_NAME", "Interviewer").strip() or "Interviewer",
        brand_title=os.getenv("BOT_BRAND_TITLE", "Eklakhya Interview Panel").strip() or "Eklakhya Interview Panel",
        headless=_env_bool("SELF_HOSTED_BOT_HEADLESS", True),
        browser_channel=os.getenv("SELF_HOSTED_BOT_CHANNEL", "chrome").strip() or "chrome",
        canvas_width=int(os.getenv("SELF_HOSTED_BOT_WIDTH", "1280")),
        canvas_height=int(os.getenv("SELF_HOSTED_BOT_HEIGHT", "720")),
        canvas_fps=int(os.getenv("SELF_HOSTED_BOT_FPS", "15")),
        default_time_limit_sec=int(os.getenv("DEFAULT_TIME_LIMIT_SEC", "300")),
        warn_before_sec=int(os.getenv("WARN_BEFORE_SEC", "60")),
        silence_timeout_sec=int(os.getenv("SILENCE_TIMEOUT_SEC", "35")),
        lobby_wait_timeout_sec=int(os.getenv("SELF_HOSTED_LOBBY_TIMEOUT_SEC", "180")),
        candidate_wait_timeout_sec=int(os.getenv("SELF_HOSTED_CANDIDATE_WAIT_SEC", "300")),
        candidate_settle_sec=float(os.getenv("SELF_HOSTED_CANDIDATE_SETTLE_SEC", "3.0")),
        ready_buffer_sec=int(os.getenv("SELF_HOSTED_READY_BUFFER_SEC", "15")),
        stt_provider=os.getenv("STT_PROVIDER", "deepgram").strip().lower() or "deepgram",
        whisper_model=os.getenv("WHISPER_MODEL", "base").strip() or "base",
        audio_dir=audio_dir,
        profile_dir=profile_dir,
        use_persistent_profile=_env_bool("SELF_HOSTED_USE_PERSISTENT_PROFILE", False),
    )
