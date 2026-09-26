import os
import io
import uuid
import json
import pymongo
import random
import string
import re
import traceback
import pandas as pd
from datetime import datetime
from fastapi import APIRouter, HTTPException, File, Form, UploadFile, BackgroundTasks
from fastapi.responses import StreamingResponse

from code.admin.students import (
    add_student, get_students, delete_student, get_student_submissions,
    set_student_terminated, reset_student_termination, increase_attempts,
    set_student_categories
)
from code.admin.bulk_operations import (
    bulk_import_students, get_student_template_file, get_question_template_file,
    send_bulk_email
)
from code.admin.monitoring import (
    get_live_exams, get_live_exam_details, get_smart_students,
    get_student_full_profile
)
from code.legacy.external_services import send_credentials_email, send_schedule_email
from code.auth.password_utils import hash_password
from fastapi import WebSocket, WebSocketDisconnect
from code.admin.ws_manager import admin_ws_manager
from code.admin.monitoring import get_live_exams
from code.core.data_manager import db, get_db
from code.questions.keyword_extractor import extract_keywords_from_text, normalize_keywords

router = APIRouter()

def generate_unique_username(db, name: str) -> str:
    # 1. Split the name by space and take the first part
    first_name = name.split()[0] if name.split() else "Student"
    
    # 2. Capitalize the first letter and make the rest lowercase
    base = first_name.capitalize().replace(".", "").replace("@", "")
    base = ''.join(c for c in base if c.isalnum())
    
    if not base:
        base = "Student"
        
    username = base
    counter = 1
    
    # 3. Add numbers if username already exists in database
    while db.users.find_one({"username": username}) or db.users.find_one({"_id": username}):
        username = f"{base}{counter}"
        counter += 1
        
    return username

# ==========================================
# 1. STUDENTS MANAGEMENT (STATIC ROUTES FIRST)
# ==========================================

@router.post("/students/add")
async def admin_add_student(
    name: str = Form(...),
    email: str = Form(...),
    send_email: bool = Form(False),
    max_attempts: int = Form(1)
):
    """Add new student directly to MongoDB"""
    try:
        email = email.strip()
        # Capitalize Name: First letter of each word capital, rest small
        name = name.strip().title()

        existing_user = db.users.find_one({"email": {"$regex": f"^{re.escape(email)}$", "$options": "i"}})
        if existing_user:
            return {"success": False, "error": "This email is already registered!"}

        username = generate_unique_username(db, name)
        # plain_password = ''.join(random.choices(string.ascii_letters + string.digits, k=8))
        plain_password = f"{username}@123"
        
        hashed_pw = hash_password(plain_password)

        new_student = {
            "username": username,
            "password": hashed_pw,
            "role": "student",
            "name": name,
            "email": email,
            "created_at": datetime.now().isoformat(),
            "attempts_taken": 0,
            "max_attempts": max_attempts,
            "is_terminated": False,
            "termination_reason": ""
        }

        db.users.insert_one(new_student)

        email_sent = False
        if send_email:
            try:
                send_credentials_email(email, name, username, plain_password)
                email_sent = True
            except Exception as e:
                print(f"[EMAIL ERROR] Failed to send email to {email}: {e}")

        return {
            "success": True, 
            "username": username, 
            "password": plain_password,
            "email_sent": email_sent,
            "message": "Student added successfully!"
        }
    except Exception as e:
        print(f"[ADD STUDENT ERROR] {e}")
        return {"success": False, "error": str(e)}

# 🟢 FIXED: bulk-import Static Route UP here, safe from {username}
bulk_import_jobs = {}

def process_bulk_import(job_id: str, content: bytes, send_email: bool):
    """Background task to process Excel strictly with MongoDB & Error Traceback"""
    try:
        # 1. Read Excel or CSV
        try:
            df = pd.read_excel(io.BytesIO(content))
        except Exception:
            df = pd.read_csv(io.BytesIO(content))
            
        df = df.fillna("")
        df.columns = [str(col).strip().lower() for col in df.columns]
        
        # 2. Dynamic Column Finder
        name_col = None
        email_col = None
        for col in df.columns:
            if any(k in col for k in ['name', 'student']):
                name_col = col
            if any(k in col for k in ['email', 'mail']):
                email_col = col
                
        if not name_col or not email_col:
            bulk_import_jobs[job_id] = {
                "status": "completed",
                "result": {"success": False, "error": "Excel file must contain 'Name' and 'Email' columns."}
            }
            return

        # 3. Use centralized MongoDB pool
        emails_sent = 0
        emails_failed = 0
        created = 0
        failed = 0
        failed_list = []
        total_rows = len(df)
        
        # 4. Process each row
        for _, row in df.iterrows():
            name = str(row[name_col]).strip()
            email = str(row[email_col]).strip()
            
            if not name or name.lower() == 'nan' or not email or email.lower() == 'nan':
                failed += 1
                failed_list.append({"name": name, "email": email, "reason": "Empty name or email"})
                continue

            # Capitalize Name: First letter of each word capital, rest small
            name = name.title()
                
            # Email validation regex
            if not re.match(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$', email):
                failed += 1
                failed_list.append({"name": name, "email": email, "reason": "Invalid email format"})
                continue
            
            # Check duplicate email in MongoDB
            if db.users.find_one({"email": {"$regex": f"^{re.escape(email)}$", "$options": "i"}}):
                failed += 1
                failed_list.append({"name": name, "email": email, "reason": "Email already registered"})
                continue
                
            # Generate credentials
            username = generate_unique_username(db, name)
            # plain_password = ''.join(random.choices(string.ascii_letters + string.digits, k=8))
            plain_password = f"{username}@123"
            hashed_pw = hash_password(plain_password)
            
            new_student = {
                "username": username,
                "password": hashed_pw,
                "role": "student",
                "name": name,
                "email": email,
                "created_at": datetime.now().isoformat(),
                "attempts_taken": 0,
                "max_attempts": 1,
                "is_terminated": False,
                "termination_reason": ""
            }
            
            # Insert directly into MongoDB
            db.users.insert_one(new_student)
            created += 1
            
            if send_email:
                try:
                    send_credentials_email(email, name, username, plain_password)
                    emails_sent += 1
                except Exception as email_err:
                    print(f"Failed to send email to {email}: {email_err}")
                    emails_failed += 1
        
        # 5. Save final result for frontend polling
        bulk_import_jobs[job_id] = {
            "status": "completed",
            "result": {
                "success": True,
                "total": total_rows,
                "created": created,
                "failed": failed,
                "failed_list": failed_list,
                "emails_sent": emails_sent,
                "emails_failed": emails_failed
            }
        }
    except Exception as e:
        # 🟢 Ab agar koi bhi error aayega, toh terminal mein poora red traceback print hoga!
        print("--- BULK IMPORT BACKGROUND TASK ERROR ---")
        traceback.print_exc()
        bulk_import_jobs[job_id] = {
            "status": "failed",
            "error": str(e)
        }

@router.post("/students/bulk-import")
async def bulk_import_students_endpoint(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    send_email: bool = Form(True)
):
    content = await file.read()
    job_id = str(uuid.uuid4())
    bulk_import_jobs[job_id] = {"status": "processing"}
    background_tasks.add_task(process_bulk_import, job_id, content, send_email)
    return {"job_id": job_id, "status": "processing"}

@router.get("/students")
async def admin_students():
    return get_students()

# 🔴 DYNAMIC ROUTE LAST in Students Category
@router.delete("/students/{username}")
async def admin_delete_student(username: str):
    """Delete student completely by triggering the deep-clean function"""
    from code.admin.students import delete_student  # 🟢 Asli deep-clean function import kiya
    
    try:
        # Yeh function file aur database dono jagah (all 13 collections) se kachra saaf karega
        result = delete_student(username)
        
        if not result.get("success"):
            raise HTTPException(400, result.get("error", "Failed to delete student"))
            
        return result
        
    except Exception as e:
        print(f"[DELETE STUDENT ERROR] {e}")
        raise HTTPException(400, str(e))
# ==========================================
# 2. STUDENT SPECIFIC ACTIONS (STATIC)
# ==========================================

@router.post("/student/terminate")
async def terminate_student_api(username: str = Form(...), reason: str = Form("Violation Limit")):
    if set_student_terminated(username, reason):
        return {"success": True}
    raise HTTPException(status_code=404, detail="Student not found")

@router.post("/student/reset-termination")
async def admin_reset_termination(username: str = Form(...)):
    if not reset_student_termination(username):
        raise HTTPException(404, "Student not found")
    return {"success": True}

@router.post("/student/increase-attempts")
async def admin_increase_attempts(username: str = Form(...), increment_by: int = Form(1)):
    result = increase_attempts(username, increment_by)
    if not result["success"]:
        raise HTTPException(404, result.get("error"))
    return result

@router.post("/student/set-categories")
async def admin_set_student_categories(username: str = Form(...), categories_json: str = Form(...)):
    try:
        categories = json.loads(categories_json)
        if not isinstance(categories, list): raise ValueError
    except:
        raise HTTPException(400, "categories_json must be JSON array")
    
    result = set_student_categories(username, categories)
    if not result["success"]:
        raise HTTPException(404, result.get("error"))
    return result

@router.get("/student-full-profile/{username}")
async def get_admin_student_full_profile(username: str):
    result = get_student_full_profile(username)
    if not result:
        raise HTTPException(404, "Student not found")
    return result


# ==========================================
# 3. QUESTIONS MANAGEMENT (PURE MONGODB)
# ==========================================

@router.post("/questions/add")
async def admin_add_question(
    question: Optional[str] = Form(default=None),
    text: Optional[str] = Form(default=None),
    category: str = Form(default="General"),
    difficulty: str = Form(default="Medium"),
    keywords: Optional[str] = Form(default=None)
):
    try:
        q_text = (question or text or "").strip()
        if not q_text:
            raise HTTPException(status_code=400, detail="Question cannot be empty")

        cat_name = category.strip()
        if cat_name:
            db.categories.update_one(
                {"name": {"$regex": f"^{re.escape(cat_name)}$", "$options": "i"}},
                {"$setOnInsert": {"name": cat_name}},
                upsert=True
            )

        max_q = db.questions.find_one(sort=[("id", -1)])
        next_id = (max_q["id"] + 1) if (max_q and "id" in max_q) else 1

        # Process speech recognition keywords
        if keywords and keywords.strip():
            raw_list = [k.strip() for k in re.split(r'[,;\n]+', keywords) if k.strip()]
            kws = normalize_keywords(raw_list)
        else:
            kws = extract_keywords_from_text(q_text, cat_name)

        new_q = {
            "id": next_id,
            "category": cat_name,
            "difficulty": difficulty.strip(),
            "question": q_text,
            "text": q_text,
            "class_name": "All",
            "keywords": kws
        }
        db.questions.insert_one(new_q)
        
        # UI fix ke liye string id return karna zaroori hai (agar DB ObjectId maange)
        if "_id" in new_q: del new_q["_id"]
        
        return {"success": True, "question": new_q}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
@router.post("/questions/update")
async def admin_update_question(
    id: int = Form(...),
    question: Optional[str] = Form(default=None),
    text: Optional[str] = Form(default=None),
    category: str = Form(...),
    difficulty: str = Form(...),
    keywords: Optional[str] = Form(default=None)
):
    q_text = (question or text or "").strip()
    if not q_text:
        raise HTTPException(status_code=400, detail="Question text cannot be empty")

    update_doc = {
        "question": q_text,
        "text": q_text,
        "category": category.strip(),
        "difficulty": difficulty.strip()
    }
    if keywords is not None and keywords.strip():
        raw_list = [k.strip() for k in re.split(r'[,;\n]+', keywords) if k.strip()]
        update_doc["keywords"] = normalize_keywords(raw_list)
    elif keywords is not None:
        update_doc["keywords"] = extract_keywords_from_text(q_text, category.strip())

    result = db.questions.update_one(
        {"id": id},
        {"$set": update_doc}
    )
    if result.modified_count > 0 or result.matched_count > 0:
        return {"success": True}
    raise HTTPException(404, "Question not found")

@router.delete("/questions/{question_id}")
async def admin_delete_question(question_id: int):
    result = db.questions.delete_one({"id": question_id})
    if result.deleted_count > 0:
        return {"success": True}
    raise HTTPException(404, "Question not found")


# ==========================================
# 4. BULK IMPORTS/EXPORTS MISC
# ==========================================

@router.post("/bulk-import/questions")
async def bulk_import_questions_endpoint(file: UploadFile = File(...)):
    try:
        content = await file.read()
        if file.filename.endswith(('.xlsx', '.xls')): df = pd.read_excel(io.BytesIO(content))
        elif file.filename.endswith('.csv'): df = pd.read_csv(io.BytesIO(content))
        else: return {"success": False, "error": "Only CSV and Excel supported."}

        df = df.fillna("")
        df.columns = [str(col).strip().lower() for col in df.columns]
        
        max_q = db.questions.find_one(sort=[("id", -1)])
        next_id = (max_q["id"] + 1) if (max_q and "id" in max_q) else 1
        
        success_count, failed_count, total_rows = 0, 0, 0
        
        for _, row in df.iterrows():
            q_text = str(row.get('question') or row.get('questions') or row.get('text') or '').strip()
            cat = str(row.get('category') or 'General').strip()
            diff = str(row.get('difficulty') or 'Medium').strip()
            cls_name = str(row.get('class') or row.get('class_name') or row.get('unnamed: 4') or 'All').strip()

            if not q_text or q_text.lower() == 'nan': continue
            total_rows += 1

            exists = db.questions.find_one({
                "$or": [
                    {"question": {"$regex": f"^{re.escape(q_text)}$", "$options": "i"}},
                    {"text": {"$regex": f"^{re.escape(q_text)}$", "$options": "i"}}
                ]
            })
            if exists:
                failed_count += 1
                continue 
                
            if cat:
                db.categories.update_one(
                    {"name": {"$regex": f"^{re.escape(cat)}$", "$options": "i"}},
                    {"$setOnInsert": {"name": cat}},
                    upsert=True
                )

            # Check if keywords provided in file, otherwise auto-extract from question & category
            raw_kw = str(row.get('keywords') or row.get('keyword') or '').strip()
            if raw_kw and raw_kw.lower() != 'nan':
                split_kws = [k.strip() for k in re.split(r'[,;]+', raw_kw) if k.strip()]
                extracted_kws = normalize_keywords(split_kws)
            else:
                extracted_kws = extract_keywords_from_text(q_text, cat)

            new_q = {
                "id": next_id,
                "question": q_text,
                "text": q_text,
                "category": cat,
                "difficulty": diff,
                "class_name": cls_name if cls_name.lower() != 'nan' and cls_name else "All",
                "keywords": extracted_kws
            }
            db.questions.insert_one(new_q)
            next_id += 1
            success_count += 1
            
        return {"success": True, "total": total_rows, "created": success_count, "failed": failed_count, "message": "Questions imported successfully!"}
    except Exception as e:
        print(f"[IMPORT ERROR] {e}")
        return {"success": False, "error": str(e)}

@router.get("/bulk-import/template/students")
async def download_student_template():
    return StreamingResponse(
        io.BytesIO(get_student_template_file()),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=student_import_template.xlsx"}
    )

@router.get("/bulk-import/template/questions")
async def download_question_template():
    return StreamingResponse(
        io.BytesIO(get_question_template_file()),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=question_import_template.xlsx"}
    )

@router.post("/bulk-email/send")
async def send_bulk_email_endpoint(usernames_json: str = Form(...), subject: str = Form(""), message: str = Form(""), email_type: str = Form("custom")):
    try: usernames = json.loads(usernames_json)
    except: raise HTTPException(400, "Invalid usernames JSON")
    if not isinstance(usernames, list) or len(usernames) == 0: raise HTTPException(400, "No students selected")
    return send_bulk_email(usernames, subject, message, email_type)

@router.get("/download-template/student")
async def download_student_template_legacy():
    return StreamingResponse(
        io.BytesIO(get_student_template_file()),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=student_import_template.xlsx"}
    )

@router.get("/download-template/question")
async def download_question_template_legacy():
    return StreamingResponse(
        io.BytesIO(get_question_template_file()),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=question_import_template.xlsx"}
    )

@router.get("/bulk-import/status/{job_id}")
async def get_bulk_import_status(job_id: str):
    if job_id not in bulk_import_jobs:
        raise HTTPException(404, "Job not found")
    return bulk_import_jobs[job_id]


# ==========================================
# 5. MONITORING & STATS (PURE MONGODB)
# ==========================================

@router.get("/dashboard-stats")
async def get_dashboard_stats():
    """Fetches stats directly from MongoDB for ultra-fast performance"""
    try:
        students_count = db.users.count_documents({"role": "student"})
        q_count = db.questions.count_documents({})
        total_submissions = db.submissions.count_documents({})
        groups_count = db.batches.count_documents({})
        
        # Unique active students
        active_students_count = len(db.submissions.distinct("username"))

        # MongoDB Aggregation to get top 5 active students instantly
        pipeline = [
            {"$group": {"_id": "$username", "name": {"$first": "$student_name"}, "count": {"$sum": 1}}},
            {"$sort": {"count": -1}},
            {"$limit": 5},
            {"$project": {"username": "$_id", "name": 1, "count": 1, "_id": 0}}
        ]
        student_activity = list(db.submissions.aggregate(pipeline))

        return {
            "total_students": students_count,
            "total_questions": q_count,
            "total_submissions": total_submissions,
            "total_groups": groups_count,
            "total_batches": groups_count,
            "active_students_count": active_students_count,
            "student_activity": student_activity
        }
    except Exception as e:
        print(f"[DASHBOARD STATS ERROR] {e}")
        return {"total_students": 0, "total_questions": 0, "total_submissions": 0, "total_groups": 0, "total_batches": 0, "active_students_count": 0, "student_activity": []}

@router.get("/live-exams")
async def get_admin_live_exams():
    return get_live_exams()

@router.get("/smart-students")
async def get_admin_smart_students(page: int = 1, limit: int = 50, search: str = ""):
    return get_smart_students(page, limit, search)

@router.get("/submissions")
async def admin_submissions(username: str = None):
    return get_student_submissions(username)

@router.get("/session-logs")
async def get_admin_session_logs(limit: int = 200):
    logs = list(db.session_logs.find({}, {"_id": 0}).sort("timestamp", -1).limit(limit))
    return {"logs": logs}

@router.get("/exam-recordings")
async def get_admin_exam_recordings():
    recordings = list(db.exam_recordings.find({}, {"_id": 0}).sort("timestamp", -1))
    return {"recordings": recordings}

@router.get("/screen-recordings")
async def get_admin_screen_recordings():
    recordings = list(db.screen_recordings.find({}, {"_id": 0}).sort("timestamp", -1))
    return {"recordings": recordings}

@router.get("/live-exam/{username}")
async def get_admin_live_exam_details(username: str):
    exam = get_live_exam_details(username)
    if not exam:
        raise HTTPException(404, f"No active exam for {username}")
    return exam

@router.websocket("/ws/admin/live-exams")
async def websocket_live_exams(websocket: WebSocket):
    await admin_ws_manager.connect(websocket)
    try:
        # Jaise hi admin connect kare, ek baar turant latest data bhej do
        initial_data = get_live_exams()
        await websocket.send_json(initial_data)
        
        while True:
            # Connection open rakhne ke liye wait karo
            await websocket.receive_text()
    except WebSocketDisconnect:
        admin_ws_manager.disconnect(websocket)