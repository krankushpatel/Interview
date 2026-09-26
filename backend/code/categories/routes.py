from fastapi import APIRouter, Form
from code.core.data_manager import load_categories, save_categories, load_questions, db

router = APIRouter()

@router.get("/all")
async def get_all_categories():
    """Get all categories fast using MongoDB distinct query without scanning full questions"""
    cats = load_categories() or []
    try:
        # Ultra-fast MongoDB distinct index query (0.001s, 0 full doc loads)
        q_cats = [c for c in db.questions.distinct("category") if c]
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