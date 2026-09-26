from fastapi import APIRouter, HTTPException, Form
from typing import Optional, List
import random
import re
from code.core.data_manager import load_questions, save_questions, load_categories, save_categories, db
from code.questions.keyword_extractor import extract_keywords_from_text, normalize_keywords

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

# fetch question from local 
@router.get("/all")
async def get_all_questions(categories: Optional[str] = None):
    """Get all questions, optionally filtered by categories"""
    questions = load_questions()
    for q in questions:
        q_text = q.get("question") or q.get("text", "")
        q["question"] = q_text
        q.pop("text", None)
        if "keywords" not in q or not q["keywords"]:
            q["keywords"] = q.get("keywords", [])
    if categories:
        cat_list = [c.strip() for c in categories.split(",")]
        filtered = [q for q in questions if q.get("category", "").lower() in [c.lower() for c in cat_list]]
        if not filtered:
            raise HTTPException(404, f"No questions found for categories: {categories}")
        return {"count": len(filtered), "questions": filtered}
    return {"count": len(questions), "questions": questions}

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
    """Get all unique question categories"""
    questions = load_questions()
    categories = sorted(set(q.get("category") for q in questions if q.get("category")))
    return categories

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
    keywords: Optional[str] = Form(default=None)
):
    """Add new question with auto or manual keywords"""
    questions = load_questions()
    categories = load_categories()
    
    q_text = (question or text or "").strip()
    if not q_text:
        raise HTTPException(status_code=400, detail="Question cannot be empty")

    cat_lower = category.lower().strip()
    if not any(c.lower() == cat_lower for c in categories):
        categories.append(category)
        save_categories(categories)
    
    # Process keywords
    if keywords and keywords.strip():
        raw_list = [k.strip() for k in re.split(r'[,;\n]+', keywords) if k.strip()]
        kws = normalize_keywords(raw_list)
    else:
        kws = extract_keywords_from_text(q_text, category.strip())

    next_id = max((q["id"] for q in questions), default=0) + 1
    new_q = {
        "id": next_id,
        "category": category.strip(),
        "difficulty": difficulty.strip(),
        "question": q_text,
        "keywords": kws
    }
    questions.append(new_q)
    save_questions(questions)
    return {"success": True, "question": new_q, "total": len(questions)}

@router.delete("/{qid}")
async def admin_delete_question(qid: int):
    """Delete question by ID"""
    questions = load_questions()
    updated = [q for q in questions if q["id"] != qid]
    
    if len(updated) == len(questions):
        raise HTTPException(status_code=404, detail=f"Question {qid} not found")
    
    save_questions(updated)
    return {"success": True, "total": len(updated)}

@router.post("/update")
async def admin_update_question(
    id: int = Form(...),
    question: Optional[str] = Form(default=None),
    text: Optional[str] = Form(default=None),
    category: str = Form(...),
    difficulty: str = Form(...),
    keywords: Optional[str] = Form(default=None)
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
                q["keywords"] = extract_keywords_from_text(q_text, category.strip())
            
            save_questions(questions)
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