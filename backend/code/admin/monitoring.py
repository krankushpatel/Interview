import os
from datetime import datetime, timedelta
from code.core.data_manager import get_loaded_data, load_users, db
from code.legacy.external_services import cleanup_idle_exams, get_active_exams, get_active_exam
from code.services.timetable_service import get_student_timetable   


def get_live_exams() -> dict:
    """Get all active exams"""
    cleanup_idle_exams(timeout_minutes=5)
    active = get_active_exams()
    return {"count": len(active), "exams": active}

def get_live_exam_details(username: str) -> dict:
    """Get details of specific active exam"""
    exam = get_active_exam(username)
    if not exam:
        return None
    return exam

def get_smart_students(page: int = 1, limit: int = 50, search: str = "") -> dict:
    """Get students sorted by priority: Live > Recent > Others"""
    users = load_users()
    data = get_loaded_data()
    students = []
    
    active_sessions = data["exam_sessions"]
    now = datetime.now()
    two_hours_ago = now - timedelta(hours=2)
    
    for username, user in users.items():
        if user.get("role") != "student":
            continue
        
        session = active_sessions.get(username)
        is_live = False
        if session and session.get("status") == "started":
            started_at = datetime.fromisoformat(session.get("started_at"))
            if (now - started_at).total_seconds() < 7200:
                is_live = True
        
        is_recent = False
        recent_completion_time = None
        if session and session.get("status") == "completed":
            ended_at = datetime.fromisoformat(session.get("ended_at"))
            if ended_at > two_hours_ago:
                is_recent = True
                recent_completion_time = ended_at
        
        last_activity = None
        session_logs = [log for log in data["session_logs"] if log["username"] == username]
        if session_logs:
            last_activity = max(datetime.fromisoformat(log["timestamp"]) for log in session_logs)
        
        students.append({
            "username": username,
            "name": user.get("name", username),
            "email": user.get("email", ""),
            "is_terminated": user.get("is_terminated", False),
            "attempts_taken": user.get("attempts_taken", 0),
            "max_attempts": user.get("max_attempts", 1),
            "is_live": is_live,
            "is_recent": is_recent,
            "recent_completion_time": recent_completion_time.isoformat() if recent_completion_time else None,
            "last_activity": last_activity.isoformat() if last_activity else None
        })
    
    if search:
        search_lower = search.lower()
        students = [s for s in students if
                    search_lower in s["name"].lower() or
                    search_lower in s["username"].lower() or
                    search_lower in s["email"].lower()]
    
    def sort_priority(s):
        if s["is_live"]:
            return 0
        elif s["is_recent"]:
            return 1
        else:
            return 2
    
    students.sort(key=sort_priority)
    
    total = len(students)
    total_pages = (total + limit - 1) // limit
    start = (page - 1) * limit
    end = start + limit
    paginated_students = students[start:end]
    
    return {
        "success": True,
        "students": paginated_students,
        "total": total,
        "page": page,
        "limit": limit,
        "total_pages": total_pages,
        "has_next": page < total_pages,
        "has_prev": page > 1
    }

def get_student_full_profile(username: str) -> dict:
    """
    Get complete student profile dynamically.
    Includes Frontend-Compatibility mappings for Proctoring Logs (event -> type).
    """

    users = load_users()
    user = users.get(username)
    if not user:
        return None

    data = get_loaded_data()
    
    # 🟢 1. FETCH ALL DATA
    evaluations_map = {}
    mongo_subs = []
    mongo_evals = []
    mongo_proctoring = []
    mongo_logs = []
    
    try:
        mongo_evals = list(db.evaluations.find({"username": username}))
        for ev in mongo_evals:
            if "_id" in ev: ev["_id"] = str(ev["_id"])
            sid = ev.get("session_id")
            if sid: evaluations_map[sid] = ev
            evaluations_map["global"] = ev
            
        mongo_subs = list(db.submissions.find({"username": username}))
        for m in mongo_subs:
            if "_id" in m: m["_id"] = str(m["_id"])
            
        # PROCTORING FETCH
        mongo_proctoring = list(db.session_proctoring_logs.find({"username": username}))
        for m in mongo_proctoring:
            if "_id" in m: m["_id"] = str(m["_id"])
            
        # Debugging Print to Terminal
        print(f"🔥 [DEBUG] Found {len(mongo_proctoring)} Proctoring Logs in MongoDB for {username}!")
            
        mongo_logs = list(db.session_logs.find({"username": username}))
        for m in mongo_logs:
            if "_id" in m: m["_id"] = str(m["_id"])
            
    except Exception as e:
        print(f"[WARN] Failed to fetch MongoDB data: {e}")

    # Merge Data safely
    json_subs = [s for s in data.get("submissions", []) if s.get("username") == username]
    merged_subs = {f"{s.get('question_id', '')}_{s.get('submitted_at', '')}": s for s in (json_subs + mongo_subs)}
    student_subs = list(merged_subs.values())

    all_proctoring = data.get("session_proctoring_logs", {}).get(username, []) + mongo_proctoring
    all_session_logs = [log for log in data.get("session_logs", []) if log.get("username") == username] + mongo_logs

    student_exam_recs = [r for r in data.get("exam_recordings", []) if r.get("username") == username]
    student_screen_recs = [r for r in data.get("screen_recordings", []) if r.get("username") == username]

    # 🟢 2. FIND ALL REAL EXAM SESSIONS (Evaluations, Submissions, Recordings, Exam Sessions)
    def is_valid_sid(sid):
        if not sid:
            return False
        s = str(sid).strip().lower()
        return s not in ["none", "null", "undefined", "", "false", "0", "[object object]"]

    exam_attempt_sids = set()
    for e in mongo_evals:
        if is_valid_sid(e.get("session_id")):
            exam_attempt_sids.add(e["session_id"])
    for s in student_subs:
        if is_valid_sid(s.get("session_id")):
            exam_attempt_sids.add(s["session_id"])
    for r in student_exam_recs + student_screen_recs:
        if is_valid_sid(r.get("session_id")):
            exam_attempt_sids.add(r["session_id"])
            
    # Check exam_sessions in MongoDB and memory
    exam_sess_doc = None
    try:
        exam_sess_doc = db.exam_sessions.find_one({"username": username})
    except Exception:
        pass
    mongo_sessions = exam_sess_doc.get("sessions", []) if (exam_sess_doc and isinstance(exam_sess_doc, dict)) else []
    memory_sessions = data.get("exam_sessions", {}).get(username, [])
    sessions_list = (mongo_sessions if isinstance(mongo_sessions, list) else ([mongo_sessions] if mongo_sessions else [])) + \
                    (memory_sessions if isinstance(memory_sessions, list) else ([memory_sessions] if memory_sessions else []))
    
    for sess in sessions_list:
        if isinstance(sess, dict) and is_valid_sid(sess.get("session_id")):
            exam_attempt_sids.add(sess["session_id"])

    # If genuine exam attempts exist (from evaluations, submissions, recordings, or sessions),
    # use ONLY those. Stray proctoring logs before exam start should NEVER create phantom attempts.
    if exam_attempt_sids:
        session_ids = exam_attempt_sids
    else:
        # Fallback only if no exam sessions exist at all
        session_ids = set()
        for p in all_proctoring:
            if is_valid_sid(p.get("session_id")):
                session_ids.add(p["session_id"])
        if not session_ids and (student_subs or all_proctoring or student_exam_recs):
            session_ids.add("legacy_attempt")

    attempts_history = []
    
    # 🟢 3. INITIALIZE ATTEMPTS
    for sid in session_ids:
        sess_meta = next((s for s in sessions_list if isinstance(s, dict) and s.get("session_id") == sid), {})
        
        timestamps = []
        for item in student_subs + student_exam_recs + all_session_logs + all_proctoring:
            if item.get("session_id") == sid:
                ts_str = item.get("submitted_at") or item.get("timestamp")
                if ts_str:
                    try:
                        if isinstance(ts_str, (int, float)): timestamps.append(datetime.fromtimestamp(ts_str / 1000.0))
                        else: timestamps.append(datetime.fromisoformat(str(ts_str)))
                    except: pass
                
        try: start_time = datetime.fromisoformat(sess_meta.get("started_at"))
        except: start_time = min(timestamps) if timestamps else (datetime.now() - timedelta(hours=1))
            
        try: end_time = datetime.fromisoformat(sess_meta.get("ended_at"))
        except: end_time = max(timestamps) if timestamps else (start_time + timedelta(hours=2))

        # Explicit lookup: Never clone another attempt's evaluation score if multiple attempts exist
        session_result = evaluations_map.get(sid) or data.get("results_store", {}).get(f"{username}_{sid}")
        if not session_result and len(session_ids) == 1:
            session_result = evaluations_map.get("global") or data.get("results_store", {}).get(username)

        attempts_history.append({
            "session_id": sid,
            "result": session_result,
            "submissions": [],
            "recordings": [],
            "screen_recordings": [],
            "proctoring": [],
            "session_logs": [],
            "start_time_obj": start_time,
            "end_time_obj": end_time,
            "started_at": start_time.isoformat(),
            "ended_at": end_time.isoformat(),
            "status": sess_meta.get("status", "completed" if session_result else "unknown")
        })

    attempts_history.sort(key=lambda x: x["start_time_obj"])
    for idx, att in enumerate(attempts_history):
        att["attempt_number"] = idx + 1

    # 🟢 4. ZERO-DROP ASSIGNMENT LOGIC
    def assign_to_attempt(item_sid, item_time, list_key, item_data):
        assigned = False
        if item_sid:
            for att in attempts_history:
                if att["session_id"] == item_sid:
                    att[list_key].append(item_data)
                    assigned = True
                    break
        if not assigned and item_time:
            for att in attempts_history:
                if att["start_time_obj"] <= item_time <= (att["end_time_obj"] + timedelta(minutes=30)):
                    att[list_key].append(item_data)
                    assigned = True
                    break
        if not assigned and attempts_history:
            attempts_history[-1][list_key].append(item_data)

    # Map Submissions
    for s in student_subs:
        try: s_time = datetime.fromisoformat(s.get("submitted_at", ""))
        except: s_time = datetime.now()
        assign_to_attempt(s.get("session_id"), s_time, "submissions", s)

    # 🎯 MAP PROCTORING LOGS (WITH UI FIXES)
    for p in all_proctoring:
        p_clean = dict(p)
        
        # UI Compatibility Fixes (Frontend needs 'type' and 'message')
        if "event" in p_clean and "type" not in p_clean:
            p_clean["type"] = p_clean["event"]
        if "detail" in p_clean and "message" not in p_clean:
            p_clean["message"] = p_clean["detail"]
            
        ts_val = p.get("timestamp")
        try: p_time = datetime.fromtimestamp(ts_val / 1000.0) if isinstance(ts_val, (int, float)) else datetime.fromisoformat(str(ts_val))
        except: p_time = datetime.now()
        
        p_clean["timestamp"] = p_time.isoformat()
        
        assign_to_attempt(p.get("session_id"), p_time, "proctoring", p_clean)

    # Map Media and Session Logs
    for r in student_exam_recs:
        try: r_time = datetime.fromisoformat(r.get("submitted_at", ""))
        except: r_time = datetime.now()
        assign_to_attempt(r.get("session_id"), r_time, "recordings", r)

    for r in student_screen_recs:
        try: r_time = datetime.fromisoformat(r.get("submitted_at", ""))
        except: r_time = datetime.now()
        assign_to_attempt(r.get("session_id"), r_time, "screen_recordings", r)

    for log in all_session_logs:
        try: l_time = datetime.fromisoformat(log.get("timestamp", ""))
        except: l_time = datetime.now()
        assign_to_attempt(log.get("session_id"), l_time, "session_logs", log)

    # Cleanup temporary objects
    for att in attempts_history:
        del att["start_time_obj"]
        del att["end_time_obj"]

    return {
        "success": True,
        "profile": {
            "username": username,
            "name": user.get("name", username),
            "email": user.get("email", ""),
            "status": "Terminated" if user.get("is_terminated") else "Active",
            "attempts_taken": user.get("attempts_taken", 0),
            "max_attempts": user.get("max_attempts", 1)
        },
        "timetable": get_student_timetable(username),
        "history": attempts_history
    }