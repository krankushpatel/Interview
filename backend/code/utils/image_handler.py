# image_handler.py
import os
from pathlib import Path
from fastapi import UploadFile, HTTPException
from PIL import Image
import io

from code.config.settings import UPLOADS_DIR as BASE_UPLOADS_DIR   # ✅ single source of truth

# Define upload directory — questions subfolder
UPLOADS_DIR = BASE_UPLOADS_DIR / "questions"
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png"}
MAX_FILE_SIZE = 5 * 1024 * 1024  # 5 MB

# ============================================================
# IMAGE RATIO CONFIGURATION
# ------------------------------------------------------------
# Standard ratio maan lo 1:1 (square).
# Agar aage koi aur ratio chahiye (jaise 16:9, 4:3),
# toh sirf STANDARD_RATIO aur RATIO_TOLERANCE change karo.
# Example:
#   STANDARD_RATIO = (16, 9)   # wide
#   STANDARD_RATIO = (4, 3)    # classic
# ============================================================
STANDARD_RATIO = (16, 9)      # width:height  <-- YAHAN CHANGE KARO
RATIO_TOLERANCE = 0.3       # 10% tolerance  <-- YAHAN CHANGE KARO


def ensure_upload_dir():
    """Ensure the upload directory exists."""
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

def validate_image_file(upload_file: UploadFile):
    """
    Validate the uploaded image file.
    Returns (is_valid, error_message, file_extension)
    """
    filename = upload_file.filename or ""
    ext = os.path.splitext(filename.lower())[1]
    if ext not in ALLOWED_EXTENSIONS:
        return False, f"Invalid file extension. Allowed: {', '.join(ALLOWED_EXTENSIONS)}", ext
    
    content = upload_file.file.read(MAX_FILE_SIZE + 1)
    upload_file.file.seek(0)
    
    if len(content) > MAX_FILE_SIZE:
        return False, f"File size exceeds {MAX_FILE_SIZE // (1024*1024)} MB limit", ext
    
    try:
        img = Image.open(io.BytesIO(content))
        width, height = img.size
        if width == 0 or height == 0:
            return False, "Invalid image dimensions", ext
        ratio = width / height
        target_ratio = STANDARD_RATIO[0] / STANDARD_RATIO[1]
        if abs(ratio - target_ratio) > RATIO_TOLERANCE:
            return False, f"Image ratio must be approximately {STANDARD_RATIO[0]}:{STANDARD_RATIO[1]} (got {width}:{height})", ext
        img.verify()
    except Exception:
        return False, "Invalid image file", ext
    
    return True, "", ext

def save_image_file(upload_file: UploadFile, question_id: int) -> str:
    """
    Save the validated image file and return the filename.
    Filename pattern: questions{question_id}image{ext}
    """
    ensure_upload_dir()
    filename = upload_file.filename or ""
    ext = os.path.splitext(filename.lower())[1]
    safe_filename = f"questions{question_id}image{ext}"
    file_path = UPLOADS_DIR / safe_filename
    
    with open(file_path, "wb") as f:
        content = upload_file.file.read()
        f.write(content)
    
    return safe_filename

def delete_image_file(filename: str):
    """
    Delete the image file if exists.
    """
    ensure_upload_dir()
    file_path = UPLOADS_DIR / filename
    try:
        if file_path.is_file():
            file_path.unlink()
    except Exception:
        pass  # best effort