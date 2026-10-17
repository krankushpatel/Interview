from fastapi import APIRouter, HTTPException, Form, UploadFile, File
from typing import Optional, List
import random
import re
from code.core.data_manager import load_questions, save_questions, load_categories, save_categories, db
from code.questions.keyword_extractor import extract_keywords_from_text, normalize_keywords
from code.utils.image_handler import validate_image_file, save_image_file, delete_image_file

router = APIRouter()

@router.get("/question")
async def get_question(id: Optional[int] = None):
    """Get random or specific question by ID"""
    questions = load_questions()
    if not questions:
        raise HTTPException(status_code=503, detail="No questions in questions.json")
    q = next((x for x in questions if x["id"] == id), None) if id else random.choice(questions)
    if not q:
        raise HTTPException(status_code=404, detail=f"Question id={id} not found")
    q_text = q.get("question") or q.get("text", "")
    return {
        "id": q["id"],
        "question": q_text,
        "category": q.get("category", "General"),
        "difficulty": q.get("difficulty", "Medium"),
        "keywords": q.get("keywords", [])
    }

DEFAULT_INTRO_QUESTION = {
    "id": 1,
    "question": "Please introduce yourself, describing your background, key technical strengths, and recent software projects.",
    "category": "Introduction",
    "difficulty": "Easy",
    "keywords": ["introduce", "background", "education", "experience", "projects", "strengths", "skills"]
}

def _is_intro_question_dict(q: dict) -> bool:
    if not isinstance(q, dict):
        return False
    if q.get("id") == 1 or str(q.get("id")) == "1":
        return True
    cat = (q.get("category") or "").strip().lower()
    if cat in ["introduction", "intro", "self-introduction", "self introduction", "general"]:
        q_text = (q.get("question") or q.get("text") or "").strip().lower()
        if any(m in q_text for m in ["introduce", "tell me about yourself", "describe yourself", "background"]):
            return True
        if q.get("id") == 1 or str(q.get("id")) == "1":
            return True
    q_text = (q.get("question") or q.get("text") or "").strip().lower()
    return any(m in q_text for m in [
        "introduce yourself", "tell me about yourself", "describe yourself", "walk me through your background"
    ])

# fetch question from local 
@router.get("/all")
async def get_all_questions(categories: Optional[str] = None):
    """Get all questions, optionally filtered by categories. Always guarantees Question 1 is Introduce Yourself."""
    questions = load_questions()
    for q in questions:
        q_text = q.get("question") or q.get("text", "")
        q["question"] = q_text
        q.pop("text", None)
        if "keywords" not in q or not q["keywords"]:
            q["keywords"] = q.get("keywords", [])

    # Find or prepare intro question
    intro_q = next((q for q in questions if _is_intro_question_dict(q)), None)
    if not intro_q:
        intro_q = DEFAULT_INTRO_QUESTION.copy()

    if categories:
        cat_list = [c.strip().lower() for c in categories.split(",") if c.strip()]
        filtered = [
            q for q in questions 
            if (q.get("category", "").strip().lower() in cat_list) and not _is_intro_question_dict(q)
        ]
        if not filtered:
            # Fallback if no category-matched questions found: return all non-intro questions
            filtered = [q for q in questions if not _is_intro_question_dict(q)]
        final_list = [intro_q] + filtered
        return {"count": len(final_list), "questions": final_list}

    # If no category filter, ensure intro_q is at index 0
    non_intro = [q for q in questions if not _is_intro_question_dict(q)]
    final_list = [intro_q] + non_intro
    return {"count": len(final_list), "questions": final_list}

#  fetch question from dipstick first then local 
# @router.get("/all")
# async def get_all_questions(categories: Optional[str] = None):
#     """
#     Get all questions.
#     Priority: Dipstick synced → Local questions.json (fallback)
#     """
#     # ✅ 1. Try Dipstick first
#     try:
#         from code.services.dipstick_auto_sync import load_dipstick_questions
#         dipstick_questions = load_dipstick_questions()
        
#         if dipstick_questions and len(dipstick_questions) > 0:
#             print(f"[Questions] ✅ Using {len(dipstick_questions)} Dipstick questions")
#             questions = dipstick_questions
#         else:
#             print("[Questions] ⚠️ Dipstick empty, using local questions.json")
#             questions = load_questions()
#     except Exception as e:
#         print(f"[Questions] ❌ Error loading Dipstick: {e}")
#         questions = load_questions()
    
#     # 2. Filter by categories
#     if categories:
#         cat_list = [c.strip() for c in categories.split(",")]
#         filtered = [q for q in questions if q.get("category", "").lower() in [c.lower() for c in cat_list]]
#         if not filtered:
#             raise HTTPException(404, f"No questions found for categories: {categories}")
#         return {"count": len(filtered), "questions": filtered}
    
#     return {"count": len(questions), "questions": questions}

@router.get("/categories")
async def get_all_categories():
    """Get all unique question categories using ultra-fast distinct query"""
    try:
        categories = sorted([c for c in db.questions.distinct("category") if c])
        if categories:
            return categories
    except Exception as e:
        print(f"[CATEGORIES] distinct error: {e}")
    cats = load_categories() or []
    return sorted(cats) if cats else ["General"]

@router.post("/extract-preview")
async def extract_preview(
    question: Optional[str] = Form(default=None),
    text: Optional[str] = Form(default=None),
    category: Optional[str] = Form(default="")
):
    """Preview auto-extracted keywords from question text"""
    q_text = (question or text or "").strip()
    kws = extract_keywords_from_text(q_text, category.strip() if category else None)
    return {"keywords": kws}

@router.post("/admin/add")
async def admin_add_question(
    question: Optional[str] = Form(default=None),
    text: Optional[str] = Form(default=None),
    category: str = Form(default="General"),
    difficulty: str = Form(default="Medium"),
    keywords: Optional[str] = Form(default=None),
    image: Optional[UploadFile] = File(None),
    hide_from_student: Optional[str] = Form(default=None),        # ✅ NEW
    send_text_only_to_ai: Optional[str] = Form(default=None) 
):
    """Add new question with auto or manual keywords and update categories fast"""
    q_text = (question or text or "").strip()
    if not q_text:
        raise HTTPException(status_code=400, detail="Question cannot be empty")

    cat_clean = category.strip() or "General"
    categories = load_categories()
    cat_lower = cat_clean.lower()
    
    # Update category in DB if new
    if not any(c.lower() == cat_lower for c in categories):
        categories.append(cat_clean)
        categories.sort()
        save_categories(categories)
    
    # Process keywords
    if keywords and keywords.strip():
        raw_list = [k.strip() for k in re.split(r'[,;\n]+', keywords) if k.strip()]
        kws = normalize_keywords(raw_list)
    else:
        kws = []

    # Fast ID calculation via MongoDB aggregation or fallback
    try:
        last_doc = db.questions.find_one({}, sort=[("id", -1)], projection={"id": 1, "_id": 0})
        next_id = (last_doc.get("id", 0) + 1) if last_doc else 1
    except Exception:
        questions = load_questions()
        next_id = max((q["id"] for q in questions), default=0) + 1
    # Handle image upload
    image_filename = None
    if image is not None:
        # Validate the image
        is_valid, error_msg, ext = validate_image_file(image)
        if not is_valid:
            raise HTTPException(status_code=400, detail=f'Invalid image: {error_msg}')
        # Save the image and get filename
        image.file.seek(0)  # reset after validation read
        image_filename = save_image_file(image, next_id)

    new_q = {
        "id": next_id,
        "category": cat_clean,
        "difficulty": difficulty.strip() or "Medium",
        "question": q_text,
        "keywords": kws
    }
    if image_filename:
        new_q["image"] = image_filename

    # ✅ NEW: Optional fields (only add if truthy)
    if hide_from_student and hide_from_student.strip().lower() in ('true', 'yes', '1'):
        # Validation: Hide requires image
        if not image_filename:
            raise HTTPException(
                status_code=400,
                detail="Cannot hide text without image. Student will see nothing."
            )
        new_q["hide_from_student"] = True

    if send_text_only_to_ai and send_text_only_to_ai.strip().lower() in ('true', 'yes', '1'):
        new_q["send_text_only_to_ai"] = True

    # Direct fast insert
    try:
        db.questions.insert_one(new_q.copy())
    except Exception as e:
        print(f"[WARN] Error inserting single question: {e}")
        # If we saved an image, delete it to avoid orphan file
        if image_filename:
            delete_image_file(image_filename)
        questions = load_questions()
        questions.append(new_q)
        save_questions(questions)

    total_count = db.questions.count_documents({})
    return {"success": True, "question": new_q, "total": total_count}

@router.delete("/{qid}")
async def admin_delete_question(qid: int):
    """Delete question by ID — direct MongoDB delete (fix for upsert-only save_questions)"""
    # Pehle question fetch karo (image delete ke liye)
    existing = db.questions.find_one({"id": qid})
    if not existing:
        raise HTTPException(status_code=404, detail=f"Question {qid} not found")

    # Associated image delete karo agar exist karti hai
    image_filename = existing.get("image")
    if image_filename:
        delete_image_file(image_filename)

    # ✅ DIRECT MONGODB DELETE — ye guaranteed delete karta hai
    result = db.questions.delete_one({"id": qid})

    if result.deleted_count > 0:
        total_count = db.questions.count_documents({})
        return {"success": True, "deleted_id": qid, "total": total_count}

    raise HTTPException(status_code=404, detail=f"Question {qid} not found")

@router.post("/update")
async def admin_update_question(
    id: int = Form(...),
    question: Optional[str] = Form(default=None),
    text: Optional[str] = Form(default=None),
    category: str = Form(...),
    difficulty: str = Form(...),
    keywords: Optional[str] = Form(default=None),
    image: Optional[UploadFile] = File(None),
    hide_from_student: Optional[str] = Form(default=None),        # ✅ NEW
    send_text_only_to_ai: Optional[str] = Form(default=None) 
):
    """Update existing question including its keywords"""
    questions = load_questions()
    q_text = (question or text or "").strip()
    if not q_text:
        raise HTTPException(status_code=400, detail="Question cannot be empty")
    
    for q in questions:
        if q["id"] == id:
            q["question"] = q_text
            q.pop("text", None)
            q["category"] = category.strip()
            q["difficulty"] = difficulty.strip()
            
            if keywords is not None and keywords.strip():
                raw_list = [k.strip() for k in re.split(r'[,;\n]+', keywords) if k.strip()]
                q["keywords"] = normalize_keywords(raw_list)
            elif "keywords" not in q or not q["keywords"]:
                q["keywords"] = []
            
            # Handle image update
            new_image_filename = None
            if image is not None:
                # Validate the image
                is_valid, error_msg, ext = validate_image_file(image)
                if not is_valid:
                    raise HTTPException(status_code=400, detail=f'Invalid image: {error_msg}')
                # Save the new image
                image.file.seek(0)  # reset after validation read
                new_image_filename = save_image_file(image, id)
                # Delete old image if exists
                old_image = q.get("image")
                if old_image:
                    delete_image_file(old_image)
                # Update the question's image field
                q["image"] = new_image_filename

            # ✅ NEW: Update hide_from_student
            if hide_from_student is not None:
                if hide_from_student.strip().lower() in ('true', 'yes', '1'):
                    # Validation: Hide requires image (either existing or new)
                    if not q.get("image"):
                        raise HTTPException(
                            status_code=400,
                            detail="Cannot hide text without image. Student will see nothing."
                        )
                    q["hide_from_student"] = True
                else:
                    q.pop("hide_from_student", None)

            # ✅ NEW: Update send_text_only_to_ai
            if send_text_only_to_ai is not None:
                if send_text_only_to_ai.strip().lower() in ('true', 'yes', '1'):
                    q["send_text_only_to_ai"] = True
                else:
                    q.pop("send_text_only_to_ai", None)

            try:
                save_questions(questions)
            except Exception as e:
                # If we saved a new image during this update, delete it to avoid orphan file
                if new_image_filename is not None:
                    delete_image_file(new_image_filename)
                raise e
            return {"success": True, "question": q}
    
    raise HTTPException(404, f"Question {id} not found")

@router.post("/admin/backfill-keywords")
async def backfill_keywords():
    """Auto-generate and save keywords for any questions that lack them"""
    questions = load_questions()
    updated_count = 0
    for q in questions:
        existing_kws = q.get("keywords")
        if not existing_kws or len(existing_kws) == 0:
            q_text = q.get("question") or q.get("text", "")
            q["keywords"] = extract_keywords_from_text(q_text, q.get("category", ""))
            updated_count += 1
    
    if updated_count > 0:
        save_questions(questions)
    
    return {
        "success": True,
        "message": f"Successfully updated {updated_count} questions with auto-generated keywords",
        "updated_count": updated_count,
        "total_questions": len(questions)
    }