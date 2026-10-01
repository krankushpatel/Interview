from fastapi import APIRouter, HTTPException, Form
import json
from datetime import datetime
from code.proctoring.manager import (
    log_proctoring_event, get_proctoring_events,
    clear_proctoring_events
)
from code.core.data_manager import add_bulk_proctoring_events
from typing import Optional

router = APIRouter()

@router.post("/log-event")
async def log_event_endpoint(
    username: str = Form(...),
    event_type: str = Form(...),
    session_id: str = Form(None),
    detail: str = Form(""),
    event_id: str = Form(None)
):
    """Frontend se aane wale individual events ko save karne ke liye"""
    await log_proctoring_event(username, event_type, detail, session_id, event_id)
    return {"success": True}

@router.post("/store-proctoring")
async def store_proctoring(
    username: str = Form(...),
    events_json: str = Form(...),
    session_id: str = Form(None)
):
    """Bulk proctoring events from frontend to MongoDB"""
    try:
        events = json.loads(events_json)
        
        # Inject metadata
        for ev in events:
            ev["session_id"] = session_id
            if "timestamp" not in ev:
                ev["timestamp"] = datetime.now().isoformat()
            elif isinstance(ev["timestamp"], (int, float)):
                ev["timestamp"] = datetime.fromtimestamp(ev["timestamp"] / 1000.0).isoformat()

        # Direct Bulk Insert in MongoDB (events already saved via /log-event are skipped by event_id)
        inserted = add_bulk_proctoring_events(username, events)
        
        return {"success": True, "count": len(events), "inserted": inserted}
    except Exception as e:
        print(f"[ROUTE ERROR] {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/clear-proctoring")
async def clear_proctoring(
    username: Optional[str] = Form(None), 
    body: dict = None 
):
    user = username or (body.get("username") if body else None)
    if not user:
        return {"success": False, "message": "Missing username"}
        
    clear_proctoring_events(user) 
    return {"success": True}

@router.get("/get-proctoring/{username}")
async def get_proctoring_events_endpoint(username: str, session_id: Optional[str] = None):
    """Get proctoring events for a user (pass ?session_id=... for a single exam session)"""
    events = get_proctoring_events(username, session_id)
    return {"events": events}

@router.get("/live-proctoring/{username}")
async def get_live_proctoring_events(username: str, limit: int = 50, session_id: Optional[str] = None):
    """Get latest proctoring events (real-time monitoring); ?session_id=... limits to one session"""
    events = get_proctoring_events(username, session_id)
    sorted_events = sorted(events, key=lambda x: x.get("timestamp", ""), reverse=True)[:limit]
    return {
        "username": username,
        "total": len(events),
        "events": sorted_events
    }
