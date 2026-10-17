"""
code/admin/images_routes.py

API endpoints for the Admin "Image Manager" tab.
- Bulk upload multiple images at once (same filename preserved)
- List all images with metadata
- Delete individual images (with usage warning)
"""

import re
from datetime import datetime
from pathlib import Path
from typing import List

from fastapi import APIRouter, HTTPException, UploadFile, File

from code.config.settings import UPLOADS_DIR
from code.core.data_manager import db
from code.utils.image_handler import (
    ALLOWED_EXTENSIONS,
    MAX_FILE_SIZE,
    validate_image_file,
)

router = APIRouter()
IMAGES_DIR = UPLOADS_DIR / "questions"

# Characters not allowed in filenames (path separators, control chars)
_INVALID_FILENAME_CHARS = re.compile(r'[\\/:*?"<>|\x00-\x1f]')


def _ensure_images_dir() -> None:
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)


def _sanitize_filename(name: str) -> str:
    """Remove path separators and control chars. Keep spaces, dots, alphanumerics."""
    if not name:
        return ""
    # Strip any directory components (path traversal protection)
    name = name.replace("\\", "/").split("/")[-1]
    name = _INVALID_FILENAME_CHARS.sub("", name)
    name = name.strip().lstrip(".")
    return name


@router.post("/images/upload")
async def upload_images(files: List[UploadFile] = File(...)):
    """
    Upload multiple images. The original filename is preserved (no renaming).
    Duplicate filenames are rejected with an error.
    """
    _ensure_images_dir()
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")

    uploaded: List[dict] = []
    failed: List[dict] = []

    for f in files:
        original_name = f.filename or "unknown"
        safe_name = _sanitize_filename(original_name)

        if not safe_name:
            failed.append({"original_name": original_name, "error": "Invalid filename"})
            continue

        ext = Path(safe_name).suffix.lower()
        if ext not in ALLOWED_EXTENSIONS:
            failed.append({"original_name": original_name, "error": f"Only {', '.join(ALLOWED_EXTENSIONS)} allowed"})
            continue

        save_path = IMAGES_DIR / safe_name

        # Duplicate check — reject if file already exists
        if save_path.exists():
            failed.append({
                "original_name": original_name,
                "filename": safe_name,
                "error": "File already exists. Delete the existing image first if you want to replace it."
            })
            continue

        try:
            is_valid, error_msg, _ = validate_image_file(f)
            if not is_valid:
                failed.append({"original_name": original_name, "filename": safe_name, "error": error_msg})
                continue

            f.file.seek(0)
            contents = f.file.read()
            with open(save_path, "wb") as out:
                out.write(contents)

            uploaded.append({
                "original_name": original_name,
                "filename": safe_name,
                "size_kb": round(len(contents) / 1024, 1),
                "url": f"/uploads/questions/{safe_name}",
            })
        except Exception as e:
            failed.append({"original_name": original_name, "filename": safe_name, "error": str(e)[:200]})

    return {
        "success": True,
        "count": len(uploaded),
        "uploaded": uploaded,
        "failed": failed,
    }


@router.get("/images/list")
async def list_images():
    """List every image in uploads/questions/ (newest first)."""
    _ensure_images_dir()
    images = []
    for p in IMAGES_DIR.iterdir():
        try:
            if not p.is_file() or p.suffix.lower() not in ALLOWED_EXTENSIONS:
                continue
            stat = p.stat()
            images.append({
                "filename": p.name,
                "size_kb": round(stat.st_size / 1024, 1),
                "uploaded_at": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                "url": f"/uploads/questions/{p.name}",
            })
        except Exception:
            continue
    images.sort(key=lambda x: x["uploaded_at"], reverse=True)
    return {"count": len(images), "images": images}


@router.delete("/images/{filename}")
async def delete_image(filename: str):
    """Delete an image. Warns if any question is using it."""
    safe_name = _sanitize_filename(filename)
    if not safe_name or safe_name != filename:
        raise HTTPException(status_code=400, detail="Invalid filename")

    file_path = IMAGES_DIR / safe_name
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="Image not found")

    try:
        usage_count = db.questions.count_documents({"image": safe_name})
    except Exception:
        usage_count = 0

    try:
        file_path.unlink()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Delete failed: {e}")

    return {
        "success": True,
        "filename": safe_name,
        "was_in_use_by": usage_count,
        "message": f"Deleted {safe_name}" + (f" (was used by {usage_count} question(s))" if usage_count else ""),
    }