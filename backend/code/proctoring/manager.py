import uuid
from datetime import datetime
from code.core.data_manager import add_proctoring_event, get_proctoring_events_db, clear_proctoring_db
from typing import Optional

async def log_proctoring_event(username: str, event_type: str, detail: str = "",
                               session_id: str = None, event_id: str = None):
    """
    Log proctoring event directly to MongoDB.
    event_id: unique id created by the frontend for this event. It makes the write
    idempotent (the same event also arrives via the end-of-exam bulk store). Events
    created on the server get a fresh id automatically.
    """
    event = {
        "timestamp": datetime.now().isoformat(),
        "event": event_type,
        "detail": detail,
        "session_id": session_id,
        "event_id": event_id or uuid.uuid4().hex,
    }

    # Naya logic: Direct database insert (skipped if this event_id already exists)
    written = add_proctoring_event(username, event)
    note = "" if written else "  [duplicate skipped]"
    print(f"[PROCTOR DB] {username} (Session: {session_id}) -> {event_type}: {detail}{note}")

def get_proctoring_events(username: str, session_id: str = None) -> list:
    """Get proctoring events for a user from DB (optionally only for one session)"""
    return get_proctoring_events_db(username, session_id)

def clear_proctoring_events(username: str):
    """Clear proctoring events (Disabled for safety)"""
    clear_proctoring_db(username)

def analyze_behavior(events: list) -> dict:
    """Analyze behavior based on proctoring events"""
    # FIX: Removed copy_attempt and window_blur from CRITICAL
    CRITICAL = {
        "tab_switch", "fullscreen_exit", "devtools_attempt",
        "multiple_faces_detected", "multiple_speakers_detected",
        "split_screen_detected", "app_switcher_detected", "face_mismatch",
        "voice_mismatch", "eye_contact_violation"
    }
    
    # Defence in depth: count an event_id only once, even if a duplicate row slipped in
    seen_ids, unique_events = set(), []
    for e in events:
        eid = e.get("event_id")
        if eid:
            if eid in seen_ids:
                continue
            seen_ids.add(eid)
        unique_events.append(e)
    events = unique_events

    crit_events = [e for e in events if e.get("event") in CRITICAL]
    crit_count = len(crit_events)
    
    if crit_count >= 5:
        classification, penalty = "Malpractices", 20
    elif crit_count >= 3:
        classification, penalty = "Malpractices", 10
    else:
        classification, penalty = "fair", 0
    
    return {
        "classification": classification,
        "events_count": len(events),
        "critical_events": [e["event"] for e in crit_events],
        "penalty_percentage": penalty,
        "reasoning": f"Detected {crit_count} critical violation(s)."
    }
