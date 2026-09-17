from pydantic import BaseModel
from typing import Optional, List

class LoginRequest(BaseModel):
    """Login request model"""
    username: str
    password: str

class SubmitAnswerRequest(BaseModel):
    """Submit answer request model"""
    answer: str
    username: str
    session_id: str
    question_id: int
    question_text: str = ""
    question_category: str = "General"
    answered_count: int = 0
    current_index: int = 0