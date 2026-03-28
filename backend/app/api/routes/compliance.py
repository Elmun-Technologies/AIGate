from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_roles
from app.models.ai_billing_subscription import AIBillingSubscription
from app.models.ai_provider import AIProvider
from app.models.ai_usage_event import AIUsageEvent
from app.models.agent import Agent
from app.models.api_key import APIKey
from app.models.approval_request import ApprovalRequest
from app.models.audit_event import AuditEvent
from app.models.policy import Policy
from app.models.tool_call import ToolCall

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


@router.get("/controls")
def compliance_controls(
    db: Session = Depends(get_db),
    _=Depends(require_roles("Admin", "Security", "Auditor")),
) -> dict:
    active_policy = db.query(Policy).filter(Policy.is_active.is_(True)).first()
    agents_count = db.query(func.count(Agent.id)).scalar() or 0
    audit_events = db.query(func.count(AuditEvent.id)).scalar() or 0
    blocked_high_risk = (
        db.query(func.count(ToolCall.id))
        .filter(ToolCall.status == "blocked", ToolCall.risk_score >= 70)
        .scalar()
        or 0
    )
    pending_approvals = (
        db.query(func.count(ApprovalRequest.id)).filter(ApprovalRequest.status == "pending").scalar() or 0
    )

    control_state = {
        "active_policy": bool(active_policy),
        "agents_count": int(agents_count),
        "audit_events": int(audit_events),
        "blocked_high_risk": int(blocked_high_risk),
        "pending_approvals": int(pending_approvals),
    }
    return {
        "metrics": control_state,
        "nist_ai_rmf": {
            "govern": "pass" if control_state["active_policy"] else "fail",
            "map": "pass" if control_state["agents_count"] > 0 else "warn",
            "measure": "pass" if control_state["audit_events"] > 0 else "warn",
            "manage": "pass" if control_state["blocked_high_risk"] > 0 else "warn",
        },
        "eu_ai_act": {
            "risk_management": "pass" if control_state["active_policy"] else "fail",
            "human_oversight": "pass" if control_state["pending_approvals"] >= 0 else "fail",
            "traceability": "pass" if control_state["audit_events"] > 0 else "warn",
            "cybersecurity": "pass" if control_state["blocked_high_risk"] > 0 else "warn",
        },
    }


@router.get("/ai-bom")
def compliance_ai_bom(
    db: Session = Depends(get_db),
    _=Depends(require_roles("Admin", "Security", "Auditor")),
) -> dict:
    provider_rows = (
        db.query(
            AIProvider.name,
            func.count(func.distinct(APIKey.id)).label("keys_count"),
            func.count(func.distinct(AIUsageEvent.model)).label("models_count"),
            func.coalesce(func.sum(AIUsageEvent.cost_usd), 0).label("cost_usd"),
        )
        .outerjoin(APIKey, APIKey.provider_id == AIProvider.id)
        .outerjoin(AIUsageEvent, AIUsageEvent.provider_id == AIProvider.id)
        .group_by(AIProvider.name)
        .order_by(AIProvider.name.asc())
        .all()
    )
    subscriptions = db.query(AIBillingSubscription).order_by(AIBillingSubscription.created_at.desc()).all()
    return {
        "providers": [
            {
                "provider": row.name,
                "keys_count": int(row.keys_count or 0),
                "models_count": int(row.models_count or 0),
                "cost_usd": float(row.cost_usd or 0),
            }
            for row in provider_rows
        ],
        "subscriptions": [
            {
                "id": str(sub.id),
                "organization_id": str(sub.organization_id),
                "provider_id": str(sub.provider_id),
                "detected_plan_name": sub.detected_plan_name,
                "estimated_monthly_cost": float(sub.estimated_monthly_cost),
                "billing_cycle": sub.billing_cycle,
                "risk_level": sub.risk_level,
                "last_seen_at": sub.last_seen_at.isoformat() if sub.last_seen_at else None,
            }
            for sub in subscriptions
        ],
    }
