"""Self-Hosted Zero-Cost AI Interviewer Bot Engine (Playwright + Virtual Canvas + WebRTC Audio Tap)."""
from .browser_worker import BrowserWorker
from .config import SelfHostedBotConfig, load_bot_config
from .orchestrator import (
    InterviewOrchestrator,
    InterviewQuestion,
    InterviewResult,
    QuestionAnswerRecord,
    normalize_questions,
    parse_chat_command,
)
from .transcriber import AudioTranscriber, TranscriptionResult

__all__ = [
    "SelfHostedBotConfig",
    "load_bot_config",
    "BrowserWorker",
    "AudioTranscriber",
    "TranscriptionResult",
    "InterviewOrchestrator",
    "InterviewQuestion",
    "InterviewResult",
    "QuestionAnswerRecord",
    "normalize_questions",
    "parse_chat_command",
]
