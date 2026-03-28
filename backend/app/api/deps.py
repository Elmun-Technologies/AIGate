from collections.abc import Generator

from fastapi import Depends, Header, HTTPException
from rq import Queue
from sqlalchemy.orm import Session

from app.core.redis_client import get_queue
from app.core.security import TokenError, decode_access_token
from app.db.session import SessionLocal
from app.models.user import User


ROLE_ALIASES = {
    "admin": "admin",
    "security": "security_approver",
    "security_approver": "security_approver",
    "auditor": "viewer",
    "viewer": "viewer",
    "developer": "developer",
}
VALID_ROLES = {"admin", "security_approver", "developer", "viewer"}


def normalize_role(role: str) -> str:
    return ROLE_ALIASES.get((role or "").strip().lower(), "")


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_rq_queue() -> Queue:
    return get_queue()


def get_current_user(
    db: Session = Depends(get_db),
    authorization: str | None = Header(default=None),
) -> User:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")
    token = authorization.split(" ", 1)[1]
    try:
        payload = decode_access_token(token)
    except TokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

    email = payload.get("sub")
    if not email:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


def require_roles(*roles: str):
    required = {normalize_role(role) for role in roles if normalize_role(role)}

    def checker(user: User = Depends(get_current_user)) -> User:
        user_role = normalize_role(user.role)
        if user_role not in VALID_ROLES:
            raise HTTPException(status_code=403, detail="Unknown role")
        if required and user_role not in required:
            raise HTTPException(status_code=403, detail="Insufficient role")
        return user

    return checker
