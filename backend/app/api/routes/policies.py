from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_roles
from app.models.policy import Policy
from app.schemas.policy import PolicyCreate, PolicyOut, PolicyUpdate
from app.services.policy_engine import evaluate_policy

router = APIRouter(prefix="/policies", tags=["policies"])


@router.get("", response_model=list[PolicyOut])
def list_policies(
    db: Session = Depends(get_db),
    _=Depends(require_roles("Admin", "Security", "Auditor")),
) -> list[Policy]:
    return db.query(Policy).order_by(Policy.created_at.desc()).all()


@router.post("", response_model=PolicyOut)
def create_policy(
    payload: PolicyCreate,
    db: Session = Depends(get_db),
    _=Depends(require_roles("Admin", "Security")),
) -> Policy:
    # Validation pass
    try:
        evaluate_policy(payload.yaml_text, {"tool": "read_db", "prompt": "", "agent_data_classification": "Public", "risk_score": 10})
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if payload.is_active:
        db.query(Policy).update({Policy.is_active: False})

    policy = Policy(**payload.model_dump())
    db.add(policy)
    db.commit()
    db.refresh(policy)
    return policy


@router.put("/{policy_id}", response_model=PolicyOut)
def update_policy(
    policy_id: UUID,
    payload: PolicyUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_roles("Admin", "Security")),
) -> Policy:
    policy = db.query(Policy).filter(Policy.id == policy_id).first()
    if not policy:
        raise HTTPException(status_code=404, detail="Policy not found")

    data = payload.model_dump(exclude_unset=True)
    if "yaml_text" in data:
        try:
            evaluate_policy(data["yaml_text"], {"tool": "read_db", "prompt": "", "agent_data_classification": "Public", "risk_score": 10})
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    if data.get("is_active") is True:
        db.query(Policy).update({Policy.is_active: False})

    for key, value in data.items():
        setattr(policy, key, value)

    db.commit()
    db.refresh(policy)
    return policy


@router.post("/{policy_id}/activate", response_model=PolicyOut)
def activate_policy(
    policy_id: UUID,
    db: Session = Depends(get_db),
    _=Depends(require_roles("Admin", "Security")),
) -> Policy:
    policy = db.query(Policy).filter(Policy.id == policy_id).first()
    if not policy:
        raise HTTPException(status_code=404, detail="Policy not found")

    db.query(Policy).update({Policy.is_active: False})
    policy.is_active = True
    db.commit()
    db.refresh(policy)
    return policy


@router.delete("/{policy_id}")
def delete_policy(
    policy_id: UUID,
    db: Session = Depends(get_db),
    _=Depends(require_roles("Admin", "Security")),
) -> dict:
    policy = db.query(Policy).filter(Policy.id == policy_id).first()
    if not policy:
        raise HTTPException(status_code=404, detail="Policy not found")

    db.delete(policy)
    db.commit()
    return {"status": "deleted"}
