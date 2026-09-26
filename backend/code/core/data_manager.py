import os
import json
from pathlib import Path
from typing import Dict, List
from pymongo import MongoClient, UpdateOne
from code.config.settings import MONGO_URI, MONGO_DB_NAME

# ==========================================
# 1. MONGODB CONNECTION INITIALIZATION (Centralized Pool)
# ==========================================
client = MongoClient(
    MONGO_URI,
    maxPoolSize=50,
    minPoolSize=5,
    serverSelectionTimeoutMS=5000,
    connectTimeoutMS=5000
)
db = client[MONGO_DB_NAME]

def get_db():
    """Get the shared thread-safe MongoDB database instance"""
    return db

def get_client():
    """Get the shared thread-safe MongoClient instance"""
    return client

# Global data store (Bridge for existing un-updated files)
_data_store = {
    "users": {},
    "questions": [],
    "submissions": [],
    "exam_recordings": [],
    "session_answers": {},
    "session_proctoring": {},
    "results_store": {},
    "screen_recordings": [],
    "session_logs": [],
    "exam_sessions": {},
    "progressive_scores": {},
    "categories": [],
    "classes": [],
    "evidence_snapshots": [],
    "timetables": {}
}

def initialize_data():
    """Load all data from MongoDB into memory on startup"""
    try:
        client.admin.command('ping')
        print(f"[SUCCESS] Connected to MongoDB database: {MONGO_DB_NAME}")
    except Exception as e:
        print(f"[CRITICAL ERROR] MongoDB connection failed: {e}")

    load_submissions()
    load_exam_recordings()
    load_session_answers()
    load_session_proctoring()
    load_results_store()
    load_screen_recordings()
    load_session_logs()
    load_exam_sessions()
    load_progressive_scores()
    load_categories()
    load_classes()
    load_evidence_snapshots()
    load_timetables()

    # Ensure questions exist in MongoDB; seed once if empty
    try:
        if db.questions.count_documents({}) == 0:
            q_file = Path("questions.json")
            if not q_file.exists():
                q_file = Path("backend/questions.json")
            if q_file.exists():
                with open(q_file, "r", encoding="utf-8") as f:
                    seed_q = json.load(f)
                    if isinstance(seed_q, list) and seed_q:
                        prepared_seed = []
                        for q in seed_q:
                            c = q.copy()
                            q_text = c.get("question") or c.get("text", "")
                            c["question"] = q_text
                            c.pop("text", None)
                            prepared_seed.append(c)
                        db.questions.insert_many(prepared_seed)
                        print(f"[SEED] Initialized {len(prepared_seed)} questions directly in MongoDB")
    except Exception as e:
        print(f"[WARN] Failed checking/seeding questions to MongoDB: {e}")
    load_questions()

def get_loaded_data() -> Dict:
    """Get reference to current data store (Legacy support)"""
    return _data_store

# ==========================================
# 2. HELPER FUNCTIONS FOR SYNCING
# ==========================================
def _save_list_to_mongo(collection_name: str, memory_key: str, key_field: str = None):
    """Saves a list-based data store using non-destructive upserts or appends"""
    collection = db[collection_name]
    items = _data_store.get(memory_key, [])
    if not items:
        return
    
    requests = []
    for item in items:
        item_copy = item.copy()
        # Find best key field for upserting
        candidate_key = key_field
        if not candidate_key:
            for k in ["id", "session_id", "username", "timestamp"]:
                if k in item_copy and item_copy[k]:
                    candidate_key = k
                    break
        
        if candidate_key and candidate_key in item_copy:
            requests.append(UpdateOne({candidate_key: item_copy[candidate_key]}, {"$set": item_copy}, upsert=True))
        else:
            filter_query = {k: v for k, v in item_copy.items() if not isinstance(v, (dict, list))}
            requests.append(UpdateOne(filter_query, {"$set": item_copy}, upsert=True))
            
    if requests:
        try:
            collection.bulk_write(requests, ordered=False)
        except Exception as e:
            print(f"[WARN] Safe bulk upsert on {collection_name}: {e}")

def _load_list_from_mongo(collection_name: str, memory_key: str):
    """Loads a list from a Mongo collection to memory"""
    collection = db[collection_name]
    _data_store[memory_key] = list(collection.find({}, {"_id": 0}))

def _save_dict_to_mongo(collection_name: str, memory_key: str):
    """Saves a dictionary-based data store using unique string keys as _id (non-destructive upserts)"""
    collection = db[collection_name]
    data = _data_store.get(memory_key, {})
    
    if not data:
        return
        
    requests = []
    for k, v in data.items():
        requests.append(UpdateOne({"_id": k}, {"$set": {"data": v}}, upsert=True))
    
    if requests:
        try:
            collection.bulk_write(requests, ordered=False)
        except Exception as e:
            print(f"[WARN] Error in safe _save_dict_to_mongo ({collection_name}): {e}")


def _load_dict_from_mongo(collection_name: str, memory_key: str):
    """Loads a dictionary from Mongo where documents have _id as key"""
    collection = db[collection_name]
    docs = collection.find({})
    _data_store[memory_key] = {doc["_id"]: doc.get("data", {}) for doc in docs}

# ==========================================
# 3. CORE READ / WRITE OPERATIONS (Replaces JSON)
# ==========================================

def load_submissions():
    _load_list_from_mongo("submissions", "submissions")

def save_submissions():
    _save_list_to_mongo("submissions", "submissions")

def load_exam_recordings():
    _load_list_from_mongo("exam_recordings", "exam_recordings")

def save_exam_recordings():
    # Only saves metadata, video is in /uploads
    _save_list_to_mongo("exam_recordings", "exam_recordings")

def load_session_answers():
    _load_dict_from_mongo("session_answers", "session_answers")

def save_session_answers():
    _save_dict_to_mongo("session_answers", "session_answers")

def load_session_proctoring():
    _load_dict_from_mongo("session_proctoring", "session_proctoring")

def save_session_proctoring():
    _save_dict_to_mongo("session_proctoring", "session_proctoring")

def load_results_store():
    _load_dict_from_mongo("results_store", "results_store")

def save_results_store():
    _save_dict_to_mongo("results_store", "results_store")

def load_screen_recordings():
    _load_list_from_mongo("screen_recordings", "screen_recordings")

def save_screen_recordings():
    _save_list_to_mongo("screen_recordings", "screen_recordings")

def load_session_logs():
    _load_list_from_mongo("session_logs", "session_logs")

def save_session_logs():
    _save_list_to_mongo("session_logs", "session_logs")

def load_exam_sessions():
    _load_dict_from_mongo("exam_sessions", "exam_sessions")

def save_exam_sessions():
    _save_dict_to_mongo("exam_sessions", "exam_sessions")

def load_progressive_scores():
    _load_dict_from_mongo("progressive_scores", "progressive_scores")

def save_progressive_scores():
    _save_dict_to_mongo("progressive_scores", "progressive_scores")

def load_timetables():
    """Load timetables matching the new schema from timetable_service"""
    global _data_store
    docs = list(db.timetables.find({}, {"_id": 0}))
    # Naya schema 'username' ko as a key use karega
    _data_store["timetables"] = {doc["username"]: doc for doc in docs if "username" in doc}

def save_timetables():
    """Save timetables directly to MongoDB in the new schema (non-destructive upserts)"""
    global _data_store
    data = _data_store.get("timetables", {})
    
    if not data:
        return
        
    requests = []
    for username, record in data.items():
        # Make sure username is in the record
        record["username"] = username
        requests.append(UpdateOne({"username": username}, {"$set": record}, upsert=True))
    
    if requests:
        try:
            db.timetables.bulk_write(requests, ordered=False)
        except Exception as e:
            print(f"[WARN] Error in safe save_timetables: {e}")


def load_categories() -> list:
    doc = db.categories.find_one({"_id": "categories_list"})
    _data_store["categories"] = doc["list"] if doc else ["General"]
    return _data_store["categories"]

def save_categories(categories: list):
    global _data_store
    db.categories.update_one({"_id": "categories_list"}, {"$set": {"list": categories}}, upsert=True)
    _data_store["categories"] = categories

def load_classes() -> list:
    """Load classes list from MongoDB"""
    doc = db.classes.find_one({"_id": "classes_list"})
    _data_store["classes"] = doc["list"] if doc else ["All"]
    return _data_store["classes"]

def save_classes(classes: list):
    """Save classes list to MongoDB and sync memory"""
    global _data_store
    db.classes.update_one({"_id": "classes_list"}, {"$set": {"list": classes}}, upsert=True)
    _data_store["classes"] = classes

# ==========================================
# 4. USERS AND QUESTIONS LOGIC
# ==========================================

def load_users() -> dict:
    users = list(db.users.find({}, {"_id": 0}))
    _data_store["users"] = {u["username"]: u for u in users} if users else {}
    return _data_store["users"]

def save_users(users: dict):
    _data_store["users"] = users
    for username, user_data in users.items():
        db.users.update_one({"username": username}, {"$set": user_data}, upsert=True)

def load_questions() -> list:
    questions = list(db.questions.find({}, {"_id": 0}))
    for q in questions:
        q_text = q.get("question") or q.get("text", "")
        q["question"] = q_text
        q.pop("text", None)
    _data_store["questions"] = questions
    return questions

def save_questions(questions: list):
    global _data_store
    if not questions:
        return
    requests = []
    for q in questions:
        q_copy = q.copy()
        q_text = q_copy.get("question") or q_copy.get("text", "")
        q_copy["question"] = q_text
        q_copy.pop("text", None)
        if "id" in q_copy:
            requests.append(UpdateOne({"id": q_copy["id"]}, {"$set": q_copy, "$unset": {"text": ""}}, upsert=True))
        else:
            requests.append(UpdateOne({"question": q_text}, {"$set": q_copy, "$unset": {"text": ""}}, upsert=True))
    if requests:
        try:
            db.questions.bulk_write(requests, ordered=False)
        except Exception as e:
            print(f"[WARN] Safe bulk upsert on questions: {e}")
    _data_store["questions"] = questions

# ==========================================
# 5. NEW DIRECT DB PROCTORING FUNCTIONS
#    (For newly updated routes.py & manager.py)
# ==========================================

def get_proctoring_events_db(username: str) -> list:
    """Fetch proctoring events directly from MongoDB (For real-time APIs)"""
    return list(db.session_proctoring_logs.find({"username": username}, {"_id": 0}))

def add_proctoring_event(username: str, event: dict):
    """Insert a single proctoring event directly to MongoDB"""
    event["username"] = username 
    db.session_proctoring_logs.insert_one(event)

def add_bulk_proctoring_events(username: str, events: list):
    """Insert multiple events at once directly to MongoDB"""
    if not events:
        return
    for ev in events:
        ev["username"] = username
    db.session_proctoring_logs.insert_many(events)

def clear_proctoring_db(username: str):
    """Clear proctoring events for a user"""
    print(f"[PREVENTED] Clear proctoring blocked for {username} in MongoDB")


# ==========================================
# 6. EVIDENCE SNAPSHOTS (DIRECT MONGODB STORAGE)
# ==========================================
EVIDENCE_FILE = Path("data/evidence.json") 

def load_evidence_snapshots():
    """Load evidence metadata directly from MongoDB collection db.evidence_snapshots"""
    global _data_store
    # Auto-migrate legacy data/evidence.json if present
    if EVIDENCE_FILE.exists():
        try:
            with open(EVIDENCE_FILE, "r", encoding="utf-8") as f:
                legacy_data = json.load(f)
                if isinstance(legacy_data, list) and legacy_data:
                    for snap in legacy_data:
                        snap_id = snap.get("id") or snap.get("timestamp")
                        query = {"id": snap_id} if snap_id else {"timestamp": snap.get("timestamp"), "username": snap.get("username")}
                        db.evidence_snapshots.update_one(query, {"$set": snap}, upsert=True)
            EVIDENCE_FILE.unlink(missing_ok=True)
            print("[MIGRATION] Migrated evidence.json into MongoDB db.evidence_snapshots")
        except Exception as e:
            print(f"[WARN] Failed migrating legacy evidence.json: {e}")

    try:
        _data_store["evidence_snapshots"] = list(db.evidence_snapshots.find({}, {"_id": 0}))
    except Exception as e:
        print(f"[WARN] Failed to load evidence_snapshots from MongoDB: {e}")
        _data_store["evidence_snapshots"] = []

def save_evidence_snapshots():
    """Save evidence metadata directly to MongoDB collection db.evidence_snapshots"""
    global _data_store
    snapshots = _data_store.get("evidence_snapshots", [])
    if not snapshots:
        return
    requests = []
    for snap in snapshots:
        snap_copy = snap.copy()
        snap_id = snap_copy.get("id") or snap_copy.get("timestamp")
        query = {"id": snap_id} if snap_id else {"timestamp": snap_copy.get("timestamp"), "username": snap_copy.get("username")}
        requests.append(UpdateOne(query, {"$set": snap_copy}, upsert=True))
    if requests:
        try:
            db.evidence_snapshots.bulk_write(requests, ordered=False)
        except Exception as e:
            print(f"[WARN] Failed to bulk save evidence snapshots to MongoDB: {e}")

def add_evidence_snapshot(snapshot: dict):
    """Save single evidence record directly into MongoDB"""
    global _data_store
    try:
        db.evidence_snapshots.insert_one(snapshot.copy())
    except Exception as e:
        print(f"[ERROR] Failed to insert evidence snapshot into MongoDB: {e}")
    if "evidence_snapshots" not in _data_store:
        _data_store["evidence_snapshots"] = []
    _data_store["evidence_snapshots"].append(snapshot)

def get_evidence_by_username(username: str) -> list:
    """Fetch all evidence snapshots strictly for a specific user directly from MongoDB"""
    try:
        user_evidence = list(db.evidence_snapshots.find({"username": username}, {"_id": 0}).sort("timestamp", -1))
        if user_evidence:
            return user_evidence
    except Exception as e:
        print(f"[WARN] MongoDB query failed for evidence snapshots: {e}")
        
    data = get_loaded_data()
    snapshots = data.get("evidence_snapshots", [])
    user_evidence = [snap for snap in snapshots if snap.get("username") == username]
    user_evidence.sort(key=lambda x: str(x.get("timestamp", "")), reverse=True)
    return user_evidence

    