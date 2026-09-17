import os
import json
import uuid
import pymongo
from datetime import datetime
from fastapi import APIRouter, HTTPException, Form, File, UploadFile
from pydantic import BaseModel
from typing import List, Dict, Any, Optional

from code.services.timetable_service import bulk_set_student_timetable
from code.services.email_service import send_schedule_email
from code.admin.bulk_operations import bulk_import_students
from code.core.data_manager import load_users, save_users, get_db, db

router = APIRouter()

class BatchSettings(BaseModel):
    allowTyping: bool
    totalQuestions: int
    topicCounts: Dict[str, Any]
    topicDistribution: Optional[List[Dict[str, Any]]] = []
    selectedClasses: Optional[List[str]] = []
    selectedCategories: Optional[List[str]] = []

@router.get("")
async def get_all_batches():
    """Return all batches as a list"""
    db = get_db()
    batches_cursor = db.batches.find({}, {"_id": 0})
    return {"batches": list(batches_cursor)}

@router.post("/create")
async def create_batch(
    name: str = Form(...),
    usernames_json: str = Form(...),
    topics_json: str = Form(default="[]"),
):
    """Create a new batch/group"""
    try:
        usernames = json.loads(usernames_json)
        topics = json.loads(topics_json)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON in usernames_json or topics_json")

    db = get_db()
    
    if db.batches.find_one({"name": {"$regex": f"^{name}$", "$options": "i"}}):
        raise HTTPException(status_code=409, detail=f"Batch '{name}' already exists")

    batch_id = str(uuid.uuid4())[:8]
    batch = {
        "id": batch_id,
        "name": name,
        "students": list(dict.fromkeys(usernames if usernames else [])),
        "topics": topics,
        "created_at": datetime.now().isoformat(),
        "last_scheduled_at": None,
    }

    db.batches.insert_one(batch)
    if "_id" in batch:
        del batch["_id"]

    return {"success": True, "batch": batch}

@router.post("/bulk-schedule")
async def batch_bulk_schedule(
    batch_id: str = Form(...),
    start_time: str = Form(...),
    end_time: str = Form(...),
    topics_json: str = Form(default="[]"),
    message: str = Form(default="")
):
    """Set interview schedule for all students in a batch"""
    db = get_db()
    batch = db.batches.find_one({"id": batch_id})
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    try:
        topics = json.loads(topics_json)
    except Exception:
        topics = []

    usernames = batch.get("students", [])

    result = bulk_set_student_timetable(
        usernames=usernames,
        start_time=start_time,
        end_time=end_time,
        topics=topics
    )

    db.batches.update_one(
        {"id": batch_id},
        {"$set": {
            "schedule": {
                "start_time": start_time,
                "end_time": end_time,
                "topics": topics,
                "message": message
            },
            "last_scheduled_at": datetime.now().isoformat(),
            "topics": topics if topics else batch.get("topics", [])
        }}
    )
    
    for uname in usernames:
        user_info = db.users.find_one({"username": uname})
        if user_info and user_info.get("email"):
            try:
                send_schedule_email(
                    to_email=user_info["email"],
                    name=user_info.get("name", uname),
                    start_time=start_time,
                    end_time=end_time,
                    topics=topics,
                    custom_message=message
                )
            except Exception as e:
                print(f"❌ [BATCH EMAIL] Failed to send mail to {uname}. Error: {e}")

    return {
        "success": True,
        "batch_name": batch["name"],
        "total": result["total"],
        "success_count": result["success_count"],
        "failed_count": result["failed_count"]
    }

@router.delete("/{batch_id}")
async def delete_batch(batch_id: str):
    """Delete a batch/group (students are NOT removed)"""
    db = get_db()
    batch = db.batches.find_one({"id": batch_id})
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    db.batches.delete_one({"id": batch_id})
    return {"success": True, "deleted": batch["name"]}

# 🟢 1ST MISSED FUNCTION ADDED BACK
@router.post("/{batch_id}/add-students")
async def add_students_to_batch(
    batch_id: str,
    usernames_json: str = Form(...),
):
    """Add more students to an existing batch and auto-apply topics/schedule"""
    db = get_db()
    batch = db.batches.find_one({"id": batch_id})
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    try:
        new_usernames = json.loads(usernames_json)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    existing = set(batch.get("students", []))
    added = [u for u in new_usernames if u not in existing]
    
    if added:
        # Push naye students MongoDB mein
        db.batches.update_one({"id": batch_id}, {"$push": {"students": {"$each": added}}})
        
        # 1. Sync Topics to new student's profile directly in MongoDB
        batch_topics = batch.get("topics", [])
        if batch_topics:
            db.users.update_many(
                {"username": {"$in": added}},
                {"$set": {"categories": batch_topics}}
            )
            print(f"✅ [AUTO-TOPICS] Assigned {batch_topics} to {len(added)} new students.")
        
        # 2. Sync Schedule & Email
        batch_schedule = batch.get("schedule")
        if batch_schedule:
            s_start = batch_schedule.get("start_time")
            s_end = batch_schedule.get("end_time")
            s_topics = batch_schedule.get("topics", [])
            s_msg = batch_schedule.get("message", "")
            
            bulk_set_student_timetable(usernames=added, start_time=s_start, end_time=s_end, topics=s_topics)
            
            for uname in added:
                u_info = db.users.find_one({"username": uname})
                if u_info and u_info.get("email"):
                    try:
                        send_schedule_email(
                            to_email=u_info["email"], 
                            name=u_info.get("name", uname), 
                            start_time=s_start, 
                            end_time=s_end, 
                            topics=s_topics, 
                            custom_message=s_msg
                        )
                        print(f"✅ [AUTO-SCHEDULE] Email sent to newly added student: {uname}")
                    except Exception as e:
                        print(f"❌ [AUTO-SCHEDULE ERROR] {uname}: {e}")

    return {
        "success": True,
        "added_count": len(added),
        "total_students": len(existing) + len(added),
    }

# 🟢 2ND MISSED FUNCTION ADDED BACK
@router.delete("/{batch_id}/students/{username}")
async def remove_student_from_batch(batch_id: str, username: str):
    """Remove a student from a batch"""
    db = get_db()
    if not db.batches.find_one({"id": batch_id}):
        raise HTTPException(status_code=404, detail="Batch not found")

    db.batches.update_one({"id": batch_id}, {"$pull": {"students": username}})
    return {"success": True}

@router.post("/{batch_id}/import-students")
async def import_students_to_batch(
    batch_id: str, 
    file: UploadFile = File(...),
    send_email: bool = Form(True) # Added flag to control emails
):
    """Import students from Excel/CSV into a batch and send credentials email."""
    db = get_db()
    batch = db.batches.find_one({"id": batch_id})
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    try:
        content = await file.read()

        users = load_users()
        emails_sent = 0
        emails_failed = 0
        
        # 🟢 Naya Email tracker callback
        def email_tracker_callback(email, name, username, password):
            nonlocal emails_sent, emails_failed
            try:
                # Actual email bhejne ka function call
                from code.legacy.external_services import send_credentials_email
                send_credentials_email(email, name, username, password)
                emails_sent += 1
                return True
            except Exception as e:
                print(f"Failed to send email to {email}: {e}")
                emails_failed += 1
                return False

        # 🟢 Pass the callback if send_email is True
        result = bulk_import_students(
            content, 
            users, 
            email_tracker_callback if send_email else None
        )

        new_usernames = [s["username"] for s in result.get("students", [])]

        current_set = set(batch.get("students", []))
        added = [u for u in new_usernames if u not in current_set]
        
        if added:
            db.batches.update_one(
                {"id": batch_id},
                {
                    "$push": {"students": {"$each": added}},
                    "$set": {"updated_at": datetime.now().isoformat()}
                }
            )

        return {
            "success": True,
            "created": result.get("created", 0),
            "failed": result.get("failed", 0),
            "added_count": len(added),
            "total_in_batch": len(current_set) + len(added),
            "emails_sent": emails_sent,
            "emails_failed": emails_failed,
            "message": "Students imported and added to batch successfully"
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Import failed: {str(e)}")

@router.post("/{batch_id}/settings")
async def save_batch_settings(batch_id: str, settings: BatchSettings):
    """Save custom exam settings for a specific batch"""
    db = get_db()
    if not db.batches.find_one({"id": batch_id}):
        raise HTTPException(status_code=404, detail="Batch not found")
    
    settings_dict = settings.dict()
    db.batches.update_one(
        {"id": batch_id},
        {"$set": {
            "settings": settings_dict,
            "updated_at": datetime.now().isoformat()
        }}
    )
    
    return {
        "success": True, 
        "message": "Group settings saved successfully!",
        "settings": settings_dict
    }

@router.post("/{batch_id}/topics")
async def update_batch_topics(batch_id: str, topics_json: str = Form(...)):
    """Update assigned topics for a specific batch"""
    db = get_db()
    if not db.batches.find_one({"id": batch_id}):
        raise HTTPException(status_code=404, detail="Batch not found")

    try:
        topics = json.loads(topics_json)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    db.batches.update_one(
        {"id": batch_id},
        {"$set": {
            "topics": topics,
            "updated_at": datetime.now().isoformat()
        }}
    )
    return {"success": True, "topics": topics}