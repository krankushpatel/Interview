"""Platform adapter factory for Zoom Web, Google Meet, and Microsoft Teams."""
from __future__ import annotations

from typing import Optional

from ..browser_worker import BrowserWorker
from .base import BasePlatformAdapter, ChatMessage
from .google_meet import GoogleMeetAdapter
from .teams_web import TeamsWebAdapter
from .zoom_web import ZoomWebAdapter, to_zoom_web_client_url


def detect_platform(meeting_url: str, provider_hint: Optional[str] = None) -> str:
    """Detect meeting platform ('zoom', 'google_meet', 'teams') from URL or explicit hint."""
    if provider_hint:
        p = provider_hint.strip().lower()
        if p in ("zoom", "zoom_web"):
            return "zoom"
        if p in ("google_meet", "meet"):
            return "google_meet"
        if p in ("teams", "ms_teams", "microsoft_teams"):
            return "teams"

    u = (meeting_url or "").strip().lower()
    if "zoom.us" in u or "zoomgov.com" in u:
        return "zoom"
    if "meet.google.com" in u:
        return "google_meet"
    if "teams.microsoft.com" in u or "teams.live.com" in u:
        return "teams"
    raise ValueError(f"Unsupported meeting URL for self-hosted bot: {meeting_url}")


def create_adapter_for_url(
    meeting_url: str,
    worker: BrowserWorker,
    provider_hint: Optional[str] = None,
) -> BasePlatformAdapter:
    platform = detect_platform(meeting_url, provider_hint=provider_hint)
    if platform == "zoom":
        return ZoomWebAdapter(worker)
    if platform == "google_meet":
        return GoogleMeetAdapter(worker)
    if platform == "teams":
        return TeamsWebAdapter(worker)
    raise ValueError(f"Unknown platform: {platform}")


__all__ = [
    "BasePlatformAdapter",
    "ChatMessage",
    "ZoomWebAdapter",
    "GoogleMeetAdapter",
    "TeamsWebAdapter",
    "to_zoom_web_client_url",
    "detect_platform",
    "create_adapter_for_url",
]
