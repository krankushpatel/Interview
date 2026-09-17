import bcrypt

def hash_password(password: str) -> str:
    """Hash a plain password using bcrypt (truncate to 72 bytes)"""
    # bcrypt has 72-byte limit; truncate if longer
    password_bytes = password.encode('utf-8')[:72]
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password_bytes, salt).decode('utf-8')

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a plain password against a bcrypt hash (truncate to 72 bytes)"""
    plain_bytes = plain_password.encode('utf-8')[:72]
    hash_bytes = hashed_password.encode('utf-8')
    return bcrypt.checkpw(plain_bytes, hash_bytes)