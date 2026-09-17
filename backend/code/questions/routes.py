from fastapi import APIRouter, HTTPException, Form
from typing import Optional
import random
from code.core.data_manager import load_questions, save_questions, load_categories, save_categories

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
    return {
        "id": q["id"],
        "text": q["text"],
        "category": q.get("category", "General"),
        "difficulty": q.get("difficulty", "Medium")
    }

# fetch question from local 
@router.get("/all")
async def get_all_questions(categories: Optional[str] = None):
    """Get all questions, optionally filtered by categories"""
    questions = load_questions()
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

@router.post("/admin/add")
async def admin_add_question(
    text: str = Form(...),
    category: str = Form(default="General"),
    difficulty: str = Form(default="Medium"),
):
    """Add new question"""
    questions = load_questions()
    categories = load_categories()
    
    cat_lower = category.lower().strip()
    if not any(c.lower() == cat_lower for c in categories):
        categories.append(category)
        save_categories(categories)
    
    next_id = max((q["id"] for q in questions), default=0) + 1
    new_q = {
        "id": next_id,
        "category": category.strip(),
        "difficulty": difficulty.strip(),
        "text": text.strip()
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
    text: str = Form(...),
    category: str = Form(...),
    difficulty: str = Form(...)
):
    """Update existing question"""
    questions = load_questions()
    
    for q in questions:
        if q["id"] == id:
            q["text"] = text.strip()
            q["category"] = category.strip()
            q["difficulty"] = difficulty.strip()
            save_questions(questions)
            return {"success": True, "question": q}
    
    raise HTTPException(404, f"Question {id} not found")