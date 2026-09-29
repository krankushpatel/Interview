from fastapi import APIRouter, HTTPException
from code.core.data_manager import get_loaded_data, db
from code.evaluation.scoring_engine import align_summary_with_final_result

router = APIRouter()

def _align_doc_summary(doc: dict) -> dict:
    if not isinstance(doc, dict):
        return doc
    fr = doc.get("final_result")
    if isinstance(fr, dict) and fr.get("summary"):
        adj_score = fr.get("adjusted_score") if fr.get("adjusted_score") is not None else (fr.get("raw_score") or 0)
        grade = fr.get("grade") or ""
        decision = fr.get("decision") or ""
        fr["summary"] = align_summary_with_final_result(fr["summary"], adj_score, grade, decision)
    return doc

@router.get("/{username}")
async def get_results(username: str, session_id: str = None):
    """Get evaluation results for a user directly from MongoDB with fallback"""
    # 1. Direct MongoDB lookup by username and session_id
    try:
        query = {"username": username}
        if session_id:
            query["session_id"] = session_id
            
        doc = db.evaluations.find_one(query, {"_id": 0}, sort=[("evaluated_at", -1), ("started_at", -1)])
        if doc:
            return _align_doc_summary(doc)
            
        # Fallback to latest evaluation for user regardless of session_id
        doc = db.evaluations.find_one({"username": username}, {"_id": 0}, sort=[("evaluated_at", -1), ("started_at", -1)])
        if doc:
            return _align_doc_summary(doc)
    except Exception as e:
        print(f"[WARN] Error querying MongoDB evaluations: {e}")

    # 2. In-memory results_store fallback
    data = get_loaded_data()
    result = None
    if session_id:
        result = data.get("results_store", {}).get(f"{username}_{session_id}")
    if not result:
        result = data.get("results_store", {}).get(username)
    if not result:
        for k in reversed(list(data.get("results_store", {}).keys())):
            if k.startswith(f"{username}_"):
                result = data["results_store"][k]
                break
                
    if not result:
        raise HTTPException(status_code=404, detail="No results found. Complete the interview first.")
        
    return _align_doc_summary(result)

@router.get("/admin/all-results")
async def admin_all_results():
    """Get all results (admin view) directly from MongoDB db.evaluations"""
    try:
        mongo_results = list(db.evaluations.find({}, {"_id": 0}).sort("evaluated_at", -1))
    except Exception as e:
        print(f"[WARN] Failed to fetch evaluations from Mongo: {e}")
        mongo_results = []
    
    seen_keys = {f"{r.get('username')}_{r.get('session_id')}" for r in mongo_results}
    data = get_loaded_data()
    for k, v in data.get("results_store", {}).items():
        if isinstance(v, dict) and f"{v.get('username')}_{v.get('session_id')}" not in seen_keys:
            mongo_results.append(v)
            
    combined_results = [_align_doc_summary(r) for r in mongo_results]
    return {
        "count": len(combined_results),
        "results": combined_results
    }

@router.get("/admin/exam-recordings")
async def admin_exam_recordings():
    """Get all exam recordings directly from MongoDB"""
    try:
        recordings = list(db.exam_recordings.find({}, {"_id": 0}).sort("submitted_at", -1))
    except Exception as e:
        print(f"[WARN] Failed fetching exam recordings from Mongo: {e}")
        recordings = []
    if not recordings:
        data = get_loaded_data()
        recordings = data.get("exam_recordings", [])
    return {
        "count": len(recordings),
        "recordings": sorted(recordings, key=lambda x: str(x.get("submitted_at", "")), reverse=True)
    }

@router.get("/admin/screen-recordings")
async def admin_screen_recordings():
    """Get all screen recordings directly from MongoDB"""
    try:
        recordings = list(db.screen_recordings.find({}, {"_id": 0}).sort("submitted_at", -1))
    except Exception as e:
        print(f"[WARN] Failed fetching screen recordings from Mongo: {e}")
        recordings = []
    if not recordings:
        data = get_loaded_data()
        recordings = data.get("screen_recordings", [])
    return {
        "count": len(recordings),
        "recordings": sorted(recordings, key=lambda x: str(x.get("submitted_at", "")), reverse=True)
    }
