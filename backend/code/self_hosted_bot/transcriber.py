"""Pluggable Speech-to-Text (STT) engine for per-question audio segments.

Supports:
- `deepgram`: Deepgram Nova-3 REST API (fast, accurate Hindi + English multilingual).
- `local_whisper`: 100% Free offline local `faster-whisper` (zero API cost).
"""
from __future__ import annotations

import asyncio
import logging
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import httpx

from .config import SelfHostedBotConfig, load_bot_config

log = logging.getLogger("self_hosted_bot.transcriber")


@dataclass
class TranscriptionResult:
    text: str
    provider: str
    word_count: int = 0
    error: Optional[str] = None


class AudioTranscriber:
    def __init__(self, config: Optional[SelfHostedBotConfig] = None) -> None:
        self.config = config or load_bot_config()
        self._whisper_model = None

    async def transcribe_file(self, audio_path: Path) -> TranscriptionResult:
        """Transcribe a single per-question audio clip (e.g., q1.webm)."""
        if not audio_path or not audio_path.exists() or audio_path.stat().st_size < 400:
            return TranscriptionResult(text="", provider="none", word_count=0)

        provider = (self.config.stt_provider or "deepgram").lower()
        deepgram_key = os.getenv("DEEPGRAM_API_KEY", "").strip()

        if provider == "deepgram" and deepgram_key:
            res = await self._transcribe_deepgram(audio_path, deepgram_key)
            if not res.error:
                return res
            log.warning("[Transcriber] Deepgram failed (%s), checking local_whisper fallback...", res.error)

        if provider == "local_whisper" or not deepgram_key:
            return await self._transcribe_local_whisper(audio_path)

        return TranscriptionResult(text="", provider=provider, word_count=0, error="No STT provider configured")

    async def _transcribe_deepgram(self, audio_path: Path, api_key: str) -> TranscriptionResult:
        model = os.getenv("DEEPGRAM_MODEL", "nova-3").strip() or "nova-3"
        language = os.getenv("DEEPGRAM_LANGUAGE", "multi").strip() or "multi"
        url = f"https://api.deepgram.com/v1/listen?model={model}&language={language}&smart_format=true&punctuate=true"

        ext = audio_path.suffix.lower()
        content_type = "audio/webm" if ext == ".webm" else "audio/ogg" if ext == ".ogg" else "audio/wav"

        try:
            audio_bytes = audio_path.read_bytes()
            headers = {
                "Authorization": f"Token {api_key}",
                "Content-Type": content_type,
            }
            async with httpx.AsyncClient(timeout=45.0) as client:
                resp = await client.post(url, content=audio_bytes, headers=headers)
                if resp.status_code >= 400:
                    return TranscriptionResult(
                        text="",
                        provider="deepgram",
                        error=f"HTTP {resp.status_code}: {resp.text[:200]}",
                    )
                data = resp.json()
                alts = (
                    data.get("results", {})
                    .get("channels", [{}])[0]
                    .get("alternatives", [{}])[0]
                )
                transcript = (alts.get("transcript") or "").strip()
                words = len(transcript.split()) if transcript else 0
                log.info("[Transcriber] Deepgram transcribed %s -> %d words", audio_path.name, words)
                return TranscriptionResult(text=transcript, provider="deepgram", word_count=words)
        except Exception as exc:
            log.warning("[Transcriber] Deepgram exception for %s: %s", audio_path.name, exc)
            return TranscriptionResult(text="", provider="deepgram", error=str(exc))

    def _run_whisper_sync(self, audio_path: Path) -> str:
        from faster_whisper import WhisperModel  # type: ignore

        if self._whisper_model is None:
            model_name = self.config.whisper_model or "base"
            log.info("[Transcriber] Loading local faster-whisper model '%s'...", model_name)
            self._whisper_model = WhisperModel(model_name, device="cpu", compute_type="int8")

        segments, _ = self._whisper_model.transcribe(str(audio_path), vad_filter=True)
        return " ".join(seg.text.strip() for seg in segments if seg.text.strip()).strip()

    async def _transcribe_local_whisper(self, audio_path: Path) -> TranscriptionResult:
        try:
            text = await asyncio.to_thread(self._run_whisper_sync, audio_path)
            words = len(text.split()) if text else 0
            log.info("[Transcriber] Local Whisper transcribed %s -> %d words", audio_path.name, words)
            return TranscriptionResult(text=text, provider="local_whisper", word_count=words)
        except ImportError:
            msg = "faster-whisper not installed (install with `pip install faster-whisper` or set DEEPGRAM_API_KEY)"
            log.warning("[Transcriber] %s", msg)
            return TranscriptionResult(text="", provider="local_whisper", error=msg)
        except Exception as exc:
            log.warning("[Transcriber] Local Whisper error for %s: %s", audio_path.name, exc)
            return TranscriptionResult(text="", provider="local_whisper", error=str(exc))
