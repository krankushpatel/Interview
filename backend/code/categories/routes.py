from fastapi import APIRouter, Form
from code.core.data_manager import load_categories, save_categories, load_questions, db

router = APIRouter()

@router.get("/all")
async def get_all_categories():
    """Get all categories"""
    cats = load_categories() or []
    try:
        questions = load_questions()
        q_cats = [q.get("category") for q in questions if q.get("category")]
        combined = sorted(list(set(cats + q_cats)))
        if combined:
            return {"categories": combined}
    except Exception as e:
        print(f"[CATEGORIES] {e}")
    return {"categories": cats if cats else ["General"]}

@router.post("/add")
async def add_category(category: str = Form(...)):
    """Add new category"""
    categories = load_categories()
    if category not in categories:
        categories.append(category)
        categories.sort()
        save_categories(categories)
    return {"success": True, "categories": categories}

# @router.delete("/{category}")
# async def delete_category(category: str):
#     """Delete category"""
#     categories = load_categories()
#     if category in categories:
#         categories.remove(category)
#         save_categories(categories)
#     return {"success": True}

@router.delete("/{category}")
async def delete_category(category: str):
    """Delete category and remove it from all groups"""
    try:
        db.categories.delete_one({"name": category}) # Example
        
        db.groups.update_many(
            {"topics": category},
            {"$pull": {"topics": category}}
        )
        
        db.groups.update_many(
            {"settings.topicDistribution.topic": category},
            {"$pull": {"settings.topicDistribution": {"topic": category}}}
        )

        return {"success": True, "message": f"Category '{category}' deleted successfully from everywhere!"}
        
    except Exception as e:
        print(f"[DELETE ERROR] {e}")
        return {"success": False, "error": str(e)}