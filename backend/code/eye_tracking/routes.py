from fastapi import APIRouter, HTTPException, Form
from typing import List, Optional
from datetime import datetime
import json
from pathlib import Path
from code.core.data_manager import db

router = APIRouter()

# Auto-migrate legacy eye_tracking_data.json once if present
EYE_TRACKING_FILE = Path("data/eye_tracking_data.json")
if EYE_TRACKING_FILE.exists():
    try:
        with open(EYE_TRACKING_FILE, "r", encoding="utf-8") as f:
            legacy_data = json.load(f)
            if isinstance(legacy_data, dict):
                for u, sessions in legacy_data.items():
                    if isinstance(sessions, dict):
                        for s_id, s_data in sessions.items():
                            db.eye_tracking.update_one(
                                {"username": u, "session_id": s_id},
                                {"$set": {
                                    "username": u,
                                    "session_id": s_id,
                                    "start_time": s_data.get("start_time"),
                                    "end_time": s_data.get("end_time"),
                                    "metrics": s_data.get("metrics", [])
                                }},
                                upsert=True
                            )
        EYE_TRACKING_FILE.unlink(missing_ok=True)
        print("[MIGRATION] Migrated eye_tracking_data.json to MongoDB db.eye_tracking")
    except Exception as e:
        print(f"[WARN] Failed migrating legacy eye_tracking_data.json: {e}")

@router.post("/log-metrics")
async def log_eye_metrics(
    username: str = Form(...),
    session_id: str = Form(...),
    metrics: str = Form(...)  # JSON string of metrics array
):
    """
    Log eye tracking metrics from frontend directly into MongoDB
    """
    try:
        metrics_list = json.loads(metrics)
        if not isinstance(metrics_list, list):
            metrics_list = [metrics_list]

        now_iso = datetime.utcnow().isoformat()
        db.eye_tracking.update_one(
            {"username": username, "session_id": session_id},
            {
                "$setOnInsert": {
                    "username": username,
                    "session_id": session_id,
                    "start_time": now_iso
                },
                "$push": {"metrics": {"$each": metrics_list}},
                "$set": {"updated_at": now_iso}
            },
            upsert=True
        )

        return {
            "success": True,
            "message": f"Logged {len(metrics_list)} metrics for {username}"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/summary/{username}/{session_id}")
async def get_eye_tracking_summary(username: str, session_id: str):
    """
    Get aggregated eye tracking summary for a student directly from MongoDB
    """
    doc = db.eye_tracking.find_one({"username": username, "session_id": session_id})
    if not doc:
        raise HTTPException(status_code=404, detail="No eye tracking data found")
    
    metrics = doc.get("metrics", [])
    if not metrics:
        return {"summary": "No metrics recorded"}
    
    # Calculate aggregated statistics
    total_duration = len(metrics) * 5  # Assuming 5-second intervals
    looking_away_time = 0
    eyes_closed_time = 0
    head_turned_time = 0
    
    gaze_directions = {"left": 0, "right": 0, "down": 0, "up": 0, "center": 0}
    
    for m in metrics:
        # Gaze direction
        gaze = m.get("gaze", {})
        h = gaze.get("horizontal", 0)
        v = gaze.get("vertical", 0)
        
        if not gaze.get("lookingAtScreen", True):
            looking_away_time += 5
            
            if h < -0.3:
                gaze_directions["left"] += 5
            elif h > 0.3:
                gaze_directions["right"] += 5
            
            if v < -0.3:
                gaze_directions["up"] += 5
            elif v > 0.3:
                gaze_directions["down"] += 5
        else:
            gaze_directions["center"] += 5
        
        # Eye closure
        if m.get("eyesClosed", False):
            eyes_closed_time += m.get("closureDurationMs", 0) / 1000
        
        # Head pose
        head = m.get("headPose", {})
        if abs(head.get("yaw", 0)) > 30 or abs(head.get("pitch", 0)) > 25:
            head_turned_time += 5
    
    return {
        "total_duration_sec": total_duration,
        "looking_away_time_sec": looking_away_time,
        "eyes_closed_time_sec": eyes_closed_time,
        "head_turned_time_sec": head_turned_time,
        "gaze_breakdown": gaze_directions,
        "attention_score": round((1 - looking_away_time / total_duration) * 100, 2) if total_duration > 0 else 0,
        "metrics_count": len(metrics)
    }
