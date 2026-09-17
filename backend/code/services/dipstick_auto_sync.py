import httpx
import json
from pathlib import Path
import os
from typing import List, Dict, Any
from pymongo import UpdateOne
from code.config.settings import DATA_DIR
from code.core.data_manager import db, get_loaded_data

DIPSTICK_API_BASE = os.getenv("DIPSTICK_API_BASE", "")
DIPSTICK_API_TOKEN = os.getenv("DIPSTICK_API_TOKEN", "")
DIPSTICK_TEST_ID = os.getenv("DIPSTICK_TEST_ID", "")

DIPSTICK_QUESTIONS_FILE = DATA_DIR / "dipstick_questions.json"

# One-time migration: If legacy dipstick_questions.json exists, migrate into MongoDB db.questions
if DIPSTICK_QUESTIONS_FILE.exists():
    try:
        with open(DIPSTICK_QUESTIONS_FILE, "r", encoding="utf-8") as f:
            legacy_qs = json.load(f)
            if isinstance(legacy_qs, list) and legacy_qs:
                reqs = [UpdateOne({"id": q["id"]}, {"$set": q}, upsert=True) for q in legacy_qs if "id" in q]
                if reqs:
                    db.questions.bulk_write(reqs, ordered=False)
                print("[MIGRATION] Migrated dipstick_questions.json to MongoDB db.questions")
        DIPSTICK_QUESTIONS_FILE.unlink(missing_ok=True)
    except Exception as e:
        print(f"[WARN] Failed migrating dipstick_questions.json: {e}")

BLOOM_TO_DIFFICULTY = {
    "l1": "Easy",
    "l2": "Medium",
    "l3": "Hard"
}

async def fetch_from_dipstick(test_id: str = DIPSTICK_TEST_ID) -> Dict:
    """Fetch questions from Dipstick API"""
    url = f"{DIPSTICK_API_BASE}/question-details/?testid={test_id}"
    
    headers = {
        "Content-Type": "application/json",
        "Authorization": f'"{DIPSTICK_API_TOKEN}"',
        "role": "1",
        "Accept": "application/json"
    }
    
    # ✅ FIX: verify=False for SSL
    async with httpx.AsyncClient(timeout=30.0, verify=False) as client:
        response = await client.get(url, headers=headers)
        response.raise_for_status()
        return response.json()

def transform_to_internal_format(dipstick_questions: List[Dict]) -> List[Dict]:
    """Convert Dipstick format to internal format"""
    internal_questions = []
    
    for idx, q in enumerate(dipstick_questions, start=1):
        # ✅ TESTING: Published filter disable
        # if not q.get("status") or not q.get("publish"):
        #     continue
        
        # ✅ FIX: Default to "l1" (Easy) if bloom'slevel missing
        bloom_level = q.get("bloom'slevel", "l1")
        if not bloom_level or bloom_level == "":
            bloom_level = "l1"
        bloom_level = str(bloom_level).lower().strip()
        difficulty = BLOOM_TO_DIFFICULTY.get(bloom_level, "Easy")
        
        category = q.get("subtopic", "General")
        
        internal_q = {
            "id": idx,
            "text": q.get("question", ""),
            "category": category,
            "difficulty": difficulty,
            "type": q.get("questionType", "DESCRIPTIVE").lower(),
            "marks": q.get("marks", 1),
            "options": q.get("options", []) if q.get("questionType") == "MCQ" else [],
            "source": "dipstick",
            "external_id": q.get("_id", "")
        }
        
        internal_questions.append(internal_q)
    
    return internal_questions

async def auto_sync_dipstick_questions():
    """Auto-sync questions from Dipstick"""
    try:
        print("[AutoSync] Fetching questions from Dipstick...")
        
        response = await fetch_from_dipstick()
        
        if not response.get("status"):
            print("[AutoSync] ❌ Dipstick API returned status: false")
            return False
        
        dipstick_questions = response.get("questions", [])
        print(f"[AutoSync] Fetched {len(dipstick_questions)} questions")
        
        internal_questions = transform_to_internal_format(dipstick_questions)
        print(f"[AutoSync] Transformed {len(internal_questions)} questions")
        
        # Save directly to MongoDB db.questions collection
        if internal_questions:
            reqs = [UpdateOne({"id": q["id"]}, {"$set": q}, upsert=True) for q in internal_questions]
            db.questions.bulk_write(reqs, ordered=False)
            data = get_loaded_data()
            data["questions"] = list(db.questions.find({}, {"_id": 0}))
        
        print(f"[AutoSync] ✅ Saved {len(internal_questions)} questions directly into MongoDB")
        return True
        
    except Exception as e:
        print(f"[AutoSync] ❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return False

def load_dipstick_questions() -> List[Dict]:
    """Load synced questions directly from MongoDB"""
    try:
        qs = list(db.questions.find({"source": "dipstick"}, {"_id": 0}))
        print(f"[DipstickQuestions] ✅ Loaded {len(qs)} questions from MongoDB")
        return qs
    except Exception as e:
        print(f"[DipstickQuestions] ❌ Error loading from MongoDB: {e}")
        return []
