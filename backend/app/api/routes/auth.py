from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.api.deps import normalize_role
from app.core.security import create_access_token, get_password_hash, verify_password
from app.models.user import User
from app.schemas.auth import LoginRequest, LoginResponse, RegisterRequest
from app.schemas.common import UserOut

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=UserOut)
def register(payload: RegisterRequest, db: Session = Depends(get_db)) -> User:
    role = normalize_role(payload.role)
    if role not in {"admin", "security_approver", "developer", "viewer"}:
        raise HTTPException(status_code=400, detail="Role must be admin, security_approver, developer, or viewer")

    exists = db.query(User).filter(User.email == payload.email).first()
    if exists:
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(
        email=payload.email,
        password_hash=get_password_hash(payload.password),
        role=role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.post("/login", response_model=LoginResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> LoginResponse:
    user = db.query(User).filter(User.email == payload.email).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = create_access_token(subject=user.email, role=normalize_role(user.role) or user.role)
    return LoginResponse(access_token=token, user=user)
