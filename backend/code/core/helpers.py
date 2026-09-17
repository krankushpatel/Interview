from datetime import datetime
import re
import json

def ts() -> str:
    """Generate timestamp string for file naming (YYYYMMdd_HHMMSS_ffffff)"""
    return datetime.now().strftime("%Y%m%d_%H%M%S_%f")

def is_empty_answer(text: str) -> bool:
    """Check if answer is completely empty or contains only placeholders"""
    EMPTY_PLACEHOLDERS = {
        "[No answer — timed out]",
        "[Skipped by student]",
        "[No answer captured]",
        "[No answer]",
        ""
    }
    if text is None:
        return True
    s = str(text).strip()
    if s == "":
        return True
    return s in EMPTY_PLACEHOLDERS

def is_skipped_answer(answer: str) -> bool:
    """Robust check for skipped-question placeholders, regardless of
    exact bracket/casing formatting used by the frontend."""
    if not answer:
        return True
    return bool(re.match(r'^\s*\[?\s*skip', answer.strip(), re.IGNORECASE))

def is_low_quality_answer(text: str) -> bool:
    """Return True for answers that are too short or lack substance (score 0)"""
    if is_empty_answer(text):
        return True
    stripped = text.strip()
    lower = stripped.lower()
    if (lower.endswith("is") or lower.endswith("are") or lower.endswith(":")) and len(stripped) < 10:
        return True
    return False

def extract_json_from_text(text: str) -> dict:
    """Extract JSON object from text response"""
    json_match = re.search(r'\{.*\}', text, re.DOTALL)
    if json_match:
        return json.loads(json_match.group())
    raise ValueError("No JSON found in response")