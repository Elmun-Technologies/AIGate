from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_roles
from app.models.policy import Policy
from app.models.policy_suggestion import PolicySuggestion
from app.schemas.policy import PolicyCreate, PolicyCreateFromTemplate, PolicyOut, PolicyUpdate
from app.services.policy_engine import evaluate_policy
from app.services.policy_optimizer import refresh_policy_suggestions
from app.services.policy_templates import get_policy_template, list_policy_templates

router = APIRouter(prefix="/policies", tags=["policies"])


@router.get("", response_model=list[PolicyOut])
def list_policies(
    db: Session = Depends(get_db),
    _=Depends(require_roles("Admin", "Security", "Auditor", "Developer")),
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
    _=Depends(require_roles("Admin")),
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
    _=Depends(require_roles("Admin")),
) -> dict:
    policy = db.query(Policy).filter(Policy.id == policy_id).first()
    if not policy:
        raise HTTPException(status_code=404, detail="Policy not found")

    db.delete(policy)
    db.commit()
    return {"status": "deleted"}


@router.get("/suggestions")
def list_policy_suggestions(
    refresh: bool = True,
    db: Session = Depends(get_db),
    _=Depends(require_roles("Admin", "Security", "Auditor")),
) -> dict:
    if refresh:
        refresh_policy_suggestions(db)
        db.commit()
    rows = (
        db.query(PolicySuggestion)
        .order_by(PolicySuggestion.created_at.desc())
        .limit(50)
        .all()
    )
    return {
        "suggestions": [
            {
                "id": str(row.id),
                "title": row.title,
                "description": row.description,
                "suggested_yaml": row.suggested_yaml,
                "confidence_score": float(row.confidence_score),
                "status": row.status,
                "source_metrics": row.source_metrics,
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
            for row in rows
        ]
    }


@router.post("/suggestions/{suggestion_id}/apply", response_model=PolicyOut)
def apply_policy_suggestion(
    suggestion_id: UUID,
    activate: bool = True,
    db: Session = Depends(get_db),
    _=Depends(require_roles("Admin", "Security")),
) -> Policy:
    suggestion = db.query(PolicySuggestion).filter(PolicySuggestion.id == suggestion_id).first()
    if not suggestion:
        raise HTTPException(status_code=404, detail="Policy suggestion not found")

    try:
        evaluate_policy(
            suggestion.suggested_yaml,
            {"tool": "read_db", "prompt": "", "agent_data_classification": "Public", "risk_score": 10},
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid suggested policy YAML: {exc}") from exc

    if activate:
        db.query(Policy).update({Policy.is_active: False})

    current_max_version = db.query(Policy.version).order_by(Policy.version.desc()).first()
    next_version = int((current_max_version[0] if current_max_version else 0) or 0) + 1
    policy = Policy(
        name=f"Suggested: {suggestion.title}",
        version=next_version,
        yaml_text=suggestion.suggested_yaml,
        is_active=activate,
    )
    suggestion.status = "applied"
    db.add(policy)
    db.commit()
    db.refresh(policy)
    return policy


@router.get("/templates/catalog")
def get_templates(
    _=Depends(require_roles("Admin", "Security", "Auditor", "Developer")),
) -> dict:
    return {"templates": list_policy_templates()}


@router.post("/templates/apply", response_model=PolicyOut)
def create_policy_from_template(
    payload: PolicyCreateFromTemplate,
    db: Session = Depends(get_db),
    _=Depends(require_roles("Admin")),
) -> Policy:
    template = get_policy_template(payload.template_key)
    if not template:
        raise HTTPException(status_code=404, detail="Unknown policy template key")

    if payload.is_active:
        db.query(Policy).update({Policy.is_active: False})

    current_max_version = db.query(Policy.version).order_by(Policy.version.desc()).first()
    next_version = int((current_max_version[0] if current_max_version else 0) or 0) + 1
    policy = Policy(
        name=payload.name or str(template["name"]),
        version=next_version,
        yaml_text=str(template["yaml_text"]),
        is_active=payload.is_active,
    )
    db.add(policy)
    db.commit()
    db.refresh(policy)
    return policy
