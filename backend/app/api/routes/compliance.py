from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_roles
from app.models.agent import Agent
from app.models.approval_request import ApprovalRequest
from app.models.audit_event import AuditEvent
from app.models.policy import Policy

router = APIRouter(prefix="/compliance", tags=["compliance"])


@router.get("/export")
def export_compliance(
    db: Session = Depends(get_db),
    _=Depends(require_roles("Admin", "Security", "Auditor")),
) -> dict:
    active_policy = db.query(Policy).filter(Policy.is_active.is_(True)).order_by(Policy.created_at.desc()).first()
    agents = db.query(Agent).order_by(Agent.created_at.desc()).all()
    events = db.query(AuditEvent).order_by(AuditEvent.created_at.desc()).limit(100).all()

    counts = {
        status: count
        for status, count in db.query(ApprovalRequest.status, func.count(ApprovalRequest.id))
        .group_by(ApprovalRequest.status)
        .all()
    }

    return {
        "active_policy_yaml": active_policy.yaml_text if active_policy else None,
        "agents_inventory": [
            {
                "id": str(agent.id),
                "name": agent.name,
                "owner_email": agent.owner_email,
                "data_classification": agent.data_classification,
                "status": agent.status,
                "created_at": agent.created_at.isoformat() if agent.created_at else None,
            }
            for agent in agents
        ],
        "last_100_audit_events": [
            {
                "id": str(event.id),
                "stream_id": event.stream_id,
                "event_type": event.event_type,
                "payload_redacted_json": event.payload_redacted_json,
                "decision": event.decision,
                "risk_score": event.risk_score,
                "prev_hash": event.prev_hash,
                "chain_hash": event.chain_hash,
                "created_at": event.created_at.isoformat() if event.created_at else None,
            }
            for event in events
        ],
        "approvals_summary": counts,
    }
