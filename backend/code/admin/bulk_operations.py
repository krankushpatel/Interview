from pathlib import Path
import io
from code.legacy.external_services import (
    parse_students_excel, parse_questions_excel,
    get_student_template, get_question_template
)
from code.core.data_manager import load_users, save_users, load_questions, save_questions, load_categories, save_categories, load_classes, save_classes, db
from code.config.settings import UPLOADS_DIR

def bulk_import_students(content: bytes, users: dict, send_email_callback=None) -> dict:
    """Import students from Excel"""
    result = parse_students_excel(content, users, send_email_callback)
    if result["success"] and result.get("created", 0) > 0:
        save_users(users)
    return result

def bulk_import_questions(content: bytes) -> dict:
    """Import questions from Excel with fast direct insertion of only new questions"""
    questions = load_questions()
    categories = load_categories()
    classes = load_classes()
    
    result = parse_questions_excel(content, questions, categories, classes)
    
    if result["success"] and result.get("questions"):
        new_questions = result["questions"]
        # Fast bulk insert only the new questions
        try:
            from pymongo import UpdateOne
            requests = [UpdateOne({"id": q["id"]}, {"$set": q, "$unset": {"text": ""}}, upsert=True) for q in new_questions]
            if requests:
                db.questions.bulk_write(requests, ordered=False)
        except Exception as e:
            print(f"[WARN] Error bulk inserting new questions: {e}")
            all_questions = questions + new_questions
            save_questions(all_questions)

        # Sync categories & classes in DB
        save_categories(categories)
        save_classes(classes)
        
    return result

def get_student_template_file() -> bytes:
    """Get student import template"""
    return get_student_template()

def get_question_template_file() -> bytes:
    """Get question import template"""
    return get_question_template()

def send_bulk_email(usernames: list, subject: str, message: str, email_type: str = "custom") -> dict:
    """Send bulk emails to students"""
    from code.services.email_service import send_credentials_email, send_custom_email
    
    users = load_users()
    results = {
        "total": len(usernames),
        "success": [],
        "failed": [],
        "failed_list": []
    }
    
    for username in usernames:
        user = users.get(username)
        if not user or user.get("role") != "student":
            results["failed"].append(username)
            results["failed_list"].append({
                "username": username,
                "reason": "Student not found"
            })
            continue
        
        email = user.get("email")
        if not email:
            results["failed"].append(username)
            results["failed_list"].append({
                "username": username,
                "reason": "No email address"
            })
            continue
        
        name = user.get("name", username)
        
        try:
            if email_type == "credentials":
                password = user.get("password", "")
                send_credentials_email(email, name, username, password)
            else:
                send_custom_email(email, name, subject, message)
            
            results["success"].append({
                "username": username,
                "email": email,
                "name": name
            })
        except Exception as e:
            results["failed"].append(username)
            results["failed_list"].append({
                "username": username,
                "email": email,
                "reason": str(e)
            })
    
    return results