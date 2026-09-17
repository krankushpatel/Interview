from datetime import datetime
from code.core.data_manager import add_proctoring_event, get_proctoring_events_db, clear_proctoring_db
from typing import Optional

async def log_proctoring_event(username: str, event_type: str, detail: str = "", session_id: str = None):
    """Log proctoring event directly to MongoDB"""
    event = {
        "timestamp": datetime.now().isoformat(),
        "event": event_type,
        "detail": detail,
        "session_id": session_id 
    }
    
    # Naya logic: Direct database insert
    add_proctoring_event(username, event)
    print(f"[PROCTOR DB] {username} (Session: {session_id}) -> {event_type}: {detail}")

def get_proctoring_events(username: str) -> list:
    """Get all proctoring events for a user from DB"""
    return get_proctoring_events_db(username)

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