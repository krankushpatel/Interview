import pandas as pd
import io
import re
import random
import string
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, List, Tuple, Optional
from code.auth.password_utils import hash_password

# Helper for case‑insensitive category addition
def add_categories_case_insensitive(new_categories: List[str], existing_categories: List[str]) -> List[str]:
    """Add only categories that don't already exist (case‑insensitive). Returns list of actually added categories."""
    added = []
    existing_lower = {c.lower() for c in existing_categories}
    for cat in new_categories:
        if cat.lower() not in existing_lower:
            existing_categories.append(cat)
            added.append(cat)
            existing_lower.add(cat.lower())
    return added


def validate_email(email: str) -> bool:
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return re.match(pattern, email) is not None

def generate_username(name: str, existing_usernames: set) -> str:
    # 1. Split the name by space and take the first part
    first_name = name.split()[0] if name.split() else "Student"
    
    # 2. Capitalize the first letter and make the rest lowercase
    base = first_name.capitalize().replace(".", "").replace("@", "")
    base = ''.join(c for c in base if c.isalnum())
    
    if not base:
        base = "Student"
        
    username = base
    counter = 1
    
    # 3. Add numbers if username already exists
    while username in existing_usernames:
        username = f"{base}{counter}"
        counter += 1
        
    return username


def generate_password() -> str:
    return ''.join(random.choices(string.ascii_letters + string.digits, k=8))


def parse_students_excel(file_content: bytes, existing_users: dict, send_email_callback=None) -> Dict[str, Any]:
    result = {
        "success": True,
        "total": 0,
        "created": 0,
        "failed": 0,
        "students": [],
        "failed_list": [],
        "error": None
    }
    
    try:
        try:
            df = pd.read_excel(io.BytesIO(file_content))
        except:
            df = pd.read_csv(io.BytesIO(file_content))
    except Exception as e:
        result["success"] = False
        result["error"] = f"Failed to read file: {str(e)}"
        return result
    
    def find_column(df, possible_names):
        for col in df.columns:
            col_lower = col.lower().strip()
            for name in possible_names:
                if name in col_lower:
                    return col
        return None
    
    name_col = find_column(df, ['name', 'student name', 'full name', 'candidate name', 'student'])
    email_col = find_column(df, ['email', 'e-mail', 'mail', 'mail id', 'student email'])
    
    if name_col is None:
        result["success"] = False
        result["error"] = "Excel file must have a column containing 'Name' (e.g., Name, Student Name, Full Name)"
        return result
    
    if email_col is None:
        result["success"] = False
        result["error"] = "Excel file must have a column containing 'Email' (e.g., Email, E-mail, Mail ID)"
        return result
    
    existing_usernames = set(existing_users.keys())
    result["total"] = len(df)
    
    for idx, row in df.iterrows():
        name = str(row[name_col]).strip()
        email = str(row[email_col]).strip()
        
        if not name or name == 'nan' or not email or email == 'nan':
            result["failed"] += 1
            result["failed_list"].append({
                "name": name if name != 'nan' else 'Empty',
                "email": email if email != 'nan' else 'Empty',
                "reason": "Empty name or email"
            })
            continue
        
        # Capitalize name (First letter of each word capital, rest small)
        name = name.title()
        
        if not validate_email(email):
            result["failed"] += 1
            result["failed_list"].append({
                "name": name,
                "email": email,
                "reason": "Invalid email format"
            })
            continue
        
        email_exists = any(user.get("email") == email for user in existing_users.values())
        if email_exists:
            result["failed"] += 1
            result["failed_list"].append({
                "name": name,
                "email": email,
                "reason": "Email already registered"
            })
            continue
        
        username = generate_username(name, existing_usernames)
        # plain_password = generate_password()
        plain_password = f"{username}@123"
        hashed_password = hash_password(plain_password)
        
        existing_users[username] = {
            "password": hashed_password,
            "role": "student",
            "name": name,
            "email": email,
            "created_at": datetime.now().isoformat(),
            "attempts_taken": 0,
            "max_attempts": 1,
            "is_terminated": False,
            "termination_reason": ""
        }
        
        existing_usernames.add(username)
        result["created"] += 1
        result["students"].append({
            "username": username,
            "password": plain_password,
            "name": name,
            "email": email
        })
        
        if send_email_callback:
            send_email_callback(email, name, username, plain_password)
    
    return result

def parse_questions_excel(content: bytes, questions: list, categories: list, classes: list = None) -> dict:
    try:
        # Excel ya CSV dono handle karein
        try:
            df = pd.read_excel(io.BytesIO(content))
        except Exception:
            df = pd.read_csv(io.BytesIO(content))

        df = df.fillna("")
        df.columns = [str(col).strip().lower() for col in df.columns]

        new_questions = []
        new_cats = set(categories)
        new_classes = set(classes) if classes is not None else set()

        next_id = max((q.get("id", 0) for q in questions), default=0) + 1
        
        # 🟢 NAYA CODE: Purane questions ka ek set bana lo (fast lookup ke liye)
        existing_texts = {str(q.get("question") or q.get("text", "")).strip().lower() for q in questions}
        duplicates_skipped = 0

        for _, row in df.iterrows():
            q_text = str(row.get('question') or row.get('questions') or row.get('text') or '').strip()
            cat = str(row.get('category') or 'General').strip()
            diff = str(row.get('difficulty') or 'Medium').strip()
            cls = str(row.get('class_name') or row.get('class') or row.get('unnamed: 4') or '').strip()

            # Agar text khali hai toh skip
            if not q_text or q_text.lower() == 'nan':
                continue

            # 🟢 NAYA CODE: Duplicate Check
            if q_text.lower() in existing_texts:
                duplicates_skipped += 1
                continue # Agar question pehle se hai, toh usko list me add mat karo!

            if cat and cat not in new_cats:
                new_cats.add(cat)
                categories.append(cat)

            if cls and cls.lower() != 'nan' and cls not in new_classes:
                new_classes.add(cls)
                if classes is not None:
                    classes.append(cls)

            new_q = {
                "id": next_id,
                "question": q_text,
                "category": cat,
                "difficulty": diff,
                "class_name": cls if cls and cls.lower() != 'nan' else "All"
            }
            next_id += 1
            new_questions.append(new_q)
            
            # Excel ke andar agar ek hi question 2 baar likha ho, toh usko block karne ke liye naye ko bhi set me daal do
            existing_texts.add(q_text.lower())

        return {
            "success": True,
            "total": len(new_questions) + duplicates_skipped, # Total rows checked
            "created": len(new_questions), # Sirf naye (non-duplicates) 
            "failed": duplicates_skipped,  # Duplicates ko failed me dikhayega taaki pop-up me clear dikhe
            "questions": new_questions
        }
    except Exception as e:
        print(f"[PARSE ERROR] {e}")
        return {"success": False, "error": str(e), "questions": []}

def get_student_template() -> bytes:
    df = pd.DataFrame({
        "name": ["John Doe", "Jane Smith"],
        "email": ["john.doe@example.com", "jane.smith@example.com"]
    })
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        df.to_excel(writer, index=False, sheet_name='Students')
    output.seek(0)
    return output.getvalue()



def get_question_template() -> bytes:
    df = pd.DataFrame({
        "question": [
            "What is polymorphism in OOP?",
            "Explain closure in JavaScript",
            "What is Python list comprehension?"
        ],
        "category": ["OOP", "JavaScript", "Python"],
        "difficulty": ["Medium", "Medium", "Easy"],
        "class name": ["susandhi", "All", "All"]  # optional column
    })
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        df.to_excel(writer, index=False, sheet_name='Questions')
    output.seek(0)
    return output.getvalue()