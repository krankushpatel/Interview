from fastapi import APIRouter
from code.core.data_manager import db

router = APIRouter()

@router.get("/all")
async def get_all_classes():
    """Fetch classes directly using MongoDB distinct query"""
    try:
        # MongoDB distinct query jo hamein [ "All", "L1-4weeks" ] degi
        db_classes = db.questions.distinct("class_name")
        
        classes = set()
        for cls in db_classes:
            if cls and str(cls).strip() and str(cls).lower() != "nan":
                classes.add(str(cls).strip())
                
        class_list = sorted(list(classes))
        if "All" not in class_list:
            class_list.insert(0, "All")
            
        return class_list
    except Exception as e:
        print(f"[ERROR] Failed to fetch classes from DB: {e}")
        return ["All"]

@router.get("/by-topic")
async def get_classes_by_topic(topic: str):
    """Fetch unique classes available for a specific topic"""
    try:
        # 🟢 Yahan database me filter lagaya hai: Sirf us topic ki classes nikalega
        db_classes = db.questions.distinct("class_name", {"category": topic})
        
        classes = set()
        for cls in db_classes:
            if cls and str(cls).strip() and str(cls).lower() != "nan":
                classes.add(str(cls).strip())
                
        class_list = sorted(list(classes))
        if "All" not in class_list:
            class_list.insert(0, "All")
            
        return class_list
    except Exception as e:
        print(f"[ERROR] Failed to fetch classes for topic {topic}: {e}")
        return ["All"]
