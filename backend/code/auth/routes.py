from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import OAuth2PasswordRequestForm
from code.models.schemas import LoginRequest
from code.core.data_manager import load_users
from .password_utils import verify_password
from .jwt_utils import create_access_token

router = APIRouter()

@router.post("/login")
async def login(body: LoginRequest):
    """Authenticate user with username and password.
    Returns basic info; if admin, also returns JWT token.
    """
    users = load_users()
    user = users.get(body.username)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid username or password")
    
    if not verify_password(body.password, user["password"]):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    
    response = {
        "success": True,
        "username": body.username,
        "name": user.get("name", body.username),
        "role": user.get("role", "student"),
        "email": user.get("email", ""),
    }
    
    # ✅ If user is admin, generate and return JWT token
    if user.get("role") == "admin":
        access_token = create_access_token(data={"sub": body.username, "role": "admin"})
        response["access_token"] = access_token
        response["token_type"] = "bearer"
    
    return response

@router.post("/token")
async def admin_login(form_data: OAuth2PasswordRequestForm = Depends()):
    """Admin login endpoint that returns JWT token. Use 'username' and 'password' as form data."""
    users = load_users()
    user = users.get(form_data.username)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not verify_password(form_data.password, user["password"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin account required")
    
    access_token = create_access_token(data={"sub": form_data.username, "role": "admin"})
    return {"access_token": access_token, "token_type": "bearer"}