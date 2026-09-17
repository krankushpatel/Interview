from fastapi import APIRouter, Form
from code.core.data_manager import load_categories, save_categories, db

router = APIRouter()

@router.get("/all")
async def get_all_categories():
    """Get all categories"""
    return {"categories": load_categories()}

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