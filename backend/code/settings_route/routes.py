"""
code/settings_route/routes.py

Exam settings endpoint — stores configurable exam parameters in MongoDB (db.exam_settings).
Accessible by admin to control interview behaviour without restarting the server.
"""

import json
from pathlib import Path
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from code.core.data_manager import db

router = APIRouter()

SETTINGS_FILE = Path(__file__).parent.parent.parent / "data" / "exam_settings.json"

# ── Default settings ─────────────────────────────────────────────────────────
DEFAULT_SETTINGS = {
    "question_timer_seconds": 300,        # Time per question (seconds)
    "max_violations": 5,                  # Violations before termination
    "pass_score_threshold": 65,           # Minimum score to pass
    "excellent_score_threshold": 80,      # Score for excellent grade
    "suspicious_violation_threshold": 2,  # Violations for suspicious classification
    "cheating_violation_threshold": 5,    # Violations for cheating classification
    "penalty_suspicious": 20,             # Score penalty % for suspicious
    "penalty_cheating": 25,               # Score penalty % for cheating
    "max_attempts_default": 1,            #  max attempts per student
    "allow_typing": True,                 # typing allow
}

# One-time migration: If legacy exam_settings.json exists, migrate to MongoDB
if SETTINGS_FILE.exists():
    try:
        saved = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
        if isinstance(saved, dict) and saved:
            db.exam_settings.update_one({"_id": "global_settings"}, {"$set": saved}, upsert=True)
            print("[MIGRATION] Migrated exam_settings.json to MongoDB db.exam_settings")
        SETTINGS_FILE.unlink(missing_ok=True)
    except Exception as e:
        print(f"[WARN] Failed to migrate exam_settings.json: {e}")

def load_settings() -> dict:
    """Load settings from MongoDB, merging with defaults for any missing keys."""
    try:
        doc = db.exam_settings.find_one({"_id": "global_settings"}, {"_id": 0})
        if doc:
            return {**DEFAULT_SETTINGS, **doc}
    except Exception as e:
        print(f"[WARN] Failed loading settings from MongoDB: {e}")
    return dict(DEFAULT_SETTINGS)

def save_settings(settings: dict):
    """Save settings directly to MongoDB"""
    try:
        db.exam_settings.update_one({"_id": "global_settings"}, {"$set": settings}, upsert=True)
    except Exception as e:
        print(f"[ERROR] Failed saving settings to MongoDB: {e}")



class ExamSettings(BaseModel):
    question_timer_seconds: Optional[int] = None
    max_violations: Optional[int] = None
    pass_score_threshold: Optional[int] = None
    excellent_score_threshold: Optional[int] = None
    suspicious_violation_threshold: Optional[int] = None
    cheating_violation_threshold: Optional[int] = None
    penalty_suspicious: Optional[int] = None
    penalty_cheating: Optional[int] = None
    max_attempts_default: Optional[int] = None
    allow_typing: bool = True


@router.get("")
async def get_settings():
    """Get current exam settings"""
    return {"settings": load_settings()}


@router.post("")
async def update_settings(body: ExamSettings):
    """Update exam settings (partial update supported)"""
    current = load_settings()

    updates = body.dict(exclude_none=True)

    # Validate ranges
    if "question_timer_seconds" in updates:
        if not (30 <= updates["question_timer_seconds"] <= 3600):
            raise HTTPException(400, "question_timer_seconds must be between 30 and 3600")

    if "max_violations" in updates:
        if not (1 <= updates["max_violations"] <= 20):
            raise HTTPException(400, "max_violations must be between 1 and 20")

    if "pass_score_threshold" in updates:
        if not (1 <= updates["pass_score_threshold"] <= 100):
            raise HTTPException(400, "pass_score_threshold must be between 1 and 100")

    if "excellent_score_threshold" in updates:
        if not (1 <= updates["excellent_score_threshold"] <= 100):
            raise HTTPException(400, "excellent_score_threshold must be between 1 and 100")

    current.update(updates)
    save_settings(current)
    print(f"[SETTINGS] Updated: {updates}")
    return {"success": True, "settings": current}


@router.post("/reset")
async def reset_settings():
    """Reset all settings to defaults"""
    save_settings(dict(DEFAULT_SETTINGS))
    return {"success": True, "settings": DEFAULT_SETTINGS}