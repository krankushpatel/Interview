from fastapi import APIRouter, HTTPException, File, Form, UploadFile
from fastapi.responses import JSONResponse, FileResponse
from pathlib import Path
from datetime import datetime
from code.config.settings import UPLOADS_DIR
from code.core.data_manager import load_users, get_loaded_data, save_exam_recordings, save_screen_recordings, add_evidence_snapshot, save_evidence_snapshots
from code.core.helpers import ts
from typing import Optional

router = APIRouter()

# ═══════════════════════════════════════════════════════════════
# ✅ NEW ENDPOINT: EVIDENCE CAPTURE (Snapshots)
# ═══════════════════════════════════════════════════════════════
@router.post("/proctoring/upload-evidence")
async def upload_evidence(
    username: str = Form(...),
    session_id: str = Form(...),
    event_name: str = Form(...),
    detail: str = Form(""),
    timestamp: str = Form(...),
    camera_image: Optional[UploadFile] = File(None),
    screen_image: Optional[UploadFile] = File(None)
):
    """Save snapshot evidence of rule violations"""
    # 1. Create a specific directory for evidence to keep things clean
    evidence_dir = UPLOADS_DIR / "evidence" / username / session_id
    evidence_dir.mkdir(parents=True, exist_ok=True)
    
    current_time_ms = ts()
    cam_filename = None
    screen_filename = None
    
    # 2. Save Camera Image if provided
    if camera_image:
        cam_ext = Path(camera_image.filename).suffix or ".jpg"
        cam_filename = f"cam_{event_name}_{current_time_ms}{cam_ext}"
        cam_path = evidence_dir / cam_filename
        contents = await camera_image.read()
        cam_path.write_bytes(contents)
        
    # 3. Save Screen Image if provided
    if screen_image:
        screen_ext = Path(screen_image.filename).suffix or ".jpg"
        screen_filename = f"screen_{event_name}_{current_time_ms}{screen_ext}"
        screen_path = evidence_dir / screen_filename
        contents = await screen_image.read()
        screen_path.write_bytes(contents)
        
    # 4. Save metadata to JSON / Memory (Admin panel me dikhane ke liye)
    record = {
        "id": current_time_ms,
        "username": username,
        "session_id": session_id,
        "event_name": event_name,
        "detail": detail,
        "timestamp": timestamp,
        "camera_image_path": f"evidence/{username}/{session_id}/{cam_filename}" if cam_filename else None,
        "screen_image_path": f"evidence/{username}/{session_id}/{screen_filename}" if screen_filename else None,
    }
    
    # 4. Save metadata directly to MongoDB (images remain on disk in UPLOADS_DIR)
    add_evidence_snapshot(record)
    
    if event_name in ["face_enrolled", "baseline_face"]:
        print(f"📸 [FACE ENROLLED] {username} -> Baseline face registered in Mongo")
    else:
        print(f"📸 [EVIDENCE SAVED TO MONGO] {username} -> {event_name}")
    return {"success": True, "record": record}

@router.post("/submit/exam-recording")
async def submit_exam_recording(
    username: str = Form(default="anonymous"),
    session_id: str = Form(...),
    duration: int = Form(default=0),
    video: UploadFile = File(...),
):
    """Submit exam recording video"""
    timestamp = ts()
    ext = Path(video.filename).suffix or ".webm"
    video_filename = f"exam_{username}_{timestamp}{ext}"
    contents = await video.read()
    (UPLOADS_DIR / video_filename).write_bytes(contents)

    users = load_users()
    student_name = users.get(username, {}).get("name", username)
    size_mb = round(len(contents) / 1024 / 1024, 2)

    record = {
        "id": timestamp,
        "username": username,
        "session_id": session_id,
        "video_file": video_filename,
        "duration_sec": duration,
        "size_mb": size_mb,
        "submitted_at": datetime.now().isoformat(),
    }
    
    data = get_loaded_data()
    data["exam_recordings"].append(record)
    save_exam_recordings()
    
    print(f"[EXAM REC] {student_name} → {video_filename} ({size_mb} MB, {duration}s)")
    return JSONResponse(content={"success": True, "filename": video_filename, "size_mb": size_mb})

@router.post("/submit/screen-recording")
async def submit_screen_recording(
    username: str = Form(...),
    session_id: str = Form(...),
    video: UploadFile = File(...),
):
    """Submit screen recording video"""
    timestamp = ts()
    ext = Path(video.filename).suffix or ".webm"
    video_filename = f"screen_{username}_{timestamp}{ext}"
    contents = await video.read()
    (UPLOADS_DIR / video_filename).write_bytes(contents)
    
    users = load_users()
    student_name = users.get(username, {}).get("name", username)
    size_mb = round(len(contents) / 1024 / 1024, 2)
    
    record = {
        "id": timestamp,
        "username": username,
        "session_id": session_id,
        "student_name": student_name,
        "video_file": video_filename,
        "size_mb": size_mb,
        "submitted_at": datetime.now().isoformat()
    }
    
    data = get_loaded_data()
    data["screen_recordings"].append(record)
    save_screen_recordings()
    
    print(f"[SCREEN REC] {student_name} → {video_filename} ({size_mb} MB)")
    return {"success": True, "filename": video_filename}

@router.get("/uploads/{filename}")
async def serve_upload(filename: str):
    """Serve uploaded file"""
    file_path = UPLOADS_DIR / filename
    if file_path.exists():
        return FileResponse(file_path, media_type='video/webm')
    raise HTTPException(404, "File not found")

# routes_2.py ke bottom me add karein (serve_upload wale route ke aas paas)

@router.get("/proctoring/evidence/{username}")
async def get_student_evidence(username: str):
    """Admin API: Get all proctoring evidence snapshots for a student"""
    try:
        from code.core.data_manager import get_evidence_by_username
        evidence = get_evidence_by_username(username)
        return {"success": True, "count": len(evidence), "evidence": evidence}
    except Exception as e:
        print(f"[ERROR] Fetching evidence failed: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to fetch evidence")