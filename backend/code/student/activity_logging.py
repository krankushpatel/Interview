from datetime import datetime
from code.core.data_manager import get_loaded_data, save_session_logs, db

def log_activity(username: str, action: str, details: str = "", session_id: str = None) -> dict:
    """Log student activity directly into MongoDB"""
    log_entry = {
        "username": username,
        "action": action,
        "details": details,
        "session_id": session_id,  
        "timestamp": datetime.now().isoformat(),
        "ip": "unknown"
    }
    
    try:
        db.session_logs.insert_one(log_entry.copy())
    except Exception as e:
        print(f"[WARN] Failed inserting activity log directly to Mongo: {e}")
        
    data = get_loaded_data()
    data.setdefault("session_logs", []).append(log_entry)
    
    print(f"[ACTIVITY] {username} -> {action}: {details} (Session: {session_id})")
    return {"success": True}

def get_session_logs(username: str = None, limit: int = 200) -> list:
    """Fetch activity logs directly from MongoDB"""
    try:
        query = {"username": username} if username else {}
        logs = list(db.session_logs.find(query, {"_id": 0}).sort("timestamp", -1).limit(limit))
        if logs:
            return logs
    except Exception as e:
        print(f"[WARN] Failed fetching session_logs from Mongo: {e}")
        
    data = get_loaded_data()
    logs = data.get("session_logs", [])
    if username:
        logs = [log for log in logs if log.get("username") == username]
    sorted_logs = sorted(logs, key=lambda x: str(x.get("timestamp", "")), reverse=True)[:limit]
    return sorted_logs
