from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from .jwt_utils import decode_access_token

security = HTTPBearer(auto_error=False)  # auto_error=False so we can handle missing token

async def get_current_admin(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Dependency to protect admin endpoints. Returns username if valid admin token."""
    if not credentials:
        raise HTTPException(status_code=401, detail="Missing authentication token")
    token = credentials.credentials
    payload = decode_access_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    if payload.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return payload.get("sub")