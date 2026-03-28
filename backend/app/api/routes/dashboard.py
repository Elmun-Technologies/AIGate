from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db, require_roles
from app.models.agent import Agent
from app.models.approval_request import ApprovalRequest
from app.models.audit_anchor import AuditAnchor
from app.models.audit_event import AuditEvent
from app.models.loss_assumption import LossAssumption
from app.models.tool_call import ToolCall
from app.models.user import User
from app.services.audit_integrity import verify_audit_rows

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/metrics")
def get_dashboard_metrics(
    db: Session = Depends(get_db),
    _=Depends(require_roles("Admin", "Security", "Auditor")),
) -> dict:
    total = db.query(func.count(ToolCall.id)).scalar() or 0
    pending = db.query(func.count(ToolCall.id)).filter(ToolCall.status == "pending").scalar() or 0
    blocked = db.query(func.count(ToolCall.id)).filter(ToolCall.status == "blocked").scalar() or 0
    executed = db.query(func.count(ToolCall.id)).filter(ToolCall.status == "executed").scalar() or 0
    pending_approvals = (
        db.query(func.count(ApprovalRequest.id))
        .filter(ApprovalRequest.status == "pending")
        .scalar()
        or 0
    )
    last_demo_calls = (
        db.query(ToolCall.status)
        .join(Agent, Agent.id == ToolCall.agent_id)
        .filter(Agent.owner_email == "simulator@gateway.local")
        .order_by(ToolCall.created_at.desc())
        .limit(6)
        .all()
    )
    last_demo_summary = {"executed": 0, "blocked": 0, "pending": 0}
    for row in last_demo_calls:
        status = str(row[0]).lower()
        if status == "executed":
            last_demo_summary["executed"] += 1
        elif status == "blocked":
            last_demo_summary["blocked"] += 1
        elif status in {"pending", "allowed"}:
            last_demo_summary["pending"] += 1

    return {
        "tool_calls_count": total,
        "pending_count": pending,
        "blocked_count": blocked,
        "executed_count": executed,
        "pending_approvals_count": pending_approvals,
        "last_demo_result": last_demo_summary,
    }


@router.get("/proof")
def get_proof_snapshot(
    db: Session = Depends(get_db),
    _=Depends(require_roles("Admin", "Security", "Auditor")),
) -> dict:
    now = datetime.now(timezone.utc)
    since_24h = now - timedelta(hours=24)

    blocked_total = db.query(func.count(ToolCall.id)).filter(ToolCall.status == "blocked").scalar() or 0
    blocked_high_risk = (
        db.query(func.count(ToolCall.id))
        .filter(ToolCall.status == "blocked", ToolCall.risk_score >= 70)
        .scalar()
        or 0
    )
    approvals_pending = (
        db.query(func.count(ApprovalRequest.id)).filter(ApprovalRequest.status == "pending").scalar() or 0
    )
    approvals_resolved = (
        db.query(func.count(ApprovalRequest.id))
        .filter(ApprovalRequest.status.in_(["approved", "rejected"]))
        .scalar()
        or 0
    )
    tool_calls_24h = (
        db.query(func.count(ToolCall.id)).filter(ToolCall.created_at >= since_24h).scalar() or 0
    )

    audit_rows = (
        db.query(AuditEvent)
        .order_by(AuditEvent.stream_id.asc(), AuditEvent.created_at.asc(), AuditEvent.id.asc())
        .all()
    )
    chain_summary = verify_audit_rows(audit_rows)
    latest_anchor = db.query(AuditAnchor).order_by(AuditAnchor.anchor_date.desc(), AuditAnchor.created_at.desc()).first()

    assumption = db.query(LossAssumption).filter(LossAssumption.organization_id == "org").first()
    prevented_loss_usd: float | None = None
    methodology: dict = {
        "formula": "blocked_high_risk_events * assumed_incident_cost_usd * confidence",
        "assumptions": None,
        "confidence_level": None,
    }
    if assumption and assumption.enabled:
        incident_cost = float(assumption.assumed_incident_cost_usd)
        confidence = float(assumption.confidence)
        threshold = int(assumption.high_risk_threshold)
        prevented_loss_usd = float(blocked_high_risk * incident_cost * confidence)
        methodology["assumptions"] = {
            "assumed_incident_cost_usd": incident_cost,
            "confidence": confidence,
            "high_risk_threshold": threshold,
        }
        methodology["confidence_level"] = confidence

    return {
        "blocked_total": int(blocked_total),
        "blocked_high_risk": int(blocked_high_risk),
        "approvals_pending": int(approvals_pending),
        "approvals_resolved": int(approvals_resolved),
        "tool_calls_24h": int(tool_calls_24h),
        "audit_records": int(chain_summary["checked_events"]),
        "audit_chain_valid": bool(chain_summary["valid"]),
        "audit_chain_issues": int(chain_summary["issues_count"]),
        "last_anchor_date": latest_anchor.anchor_date.isoformat() if latest_anchor else None,
        "last_anchor_ref": latest_anchor.anchor_ref if latest_anchor else None,
        "estimated_prevented_loss_usd": prevented_loss_usd,
        "prevented_loss_methodology": methodology,
    }


@router.get("/loss-assumptions")
def get_loss_assumptions(
    db: Session = Depends(get_db),
    _=Depends(require_roles("Admin", "Security", "Auditor", "Developer")),
) -> dict:
    assumption = db.query(LossAssumption).filter(LossAssumption.organization_id == "org").first()
    if not assumption:
        return {
            "organization_id": "org",
            "assumed_incident_cost_usd": None,
            "confidence": None,
            "high_risk_threshold": None,
            "enabled": False,
            "updated_at": None,
        }
    return {
        "organization_id": assumption.organization_id,
        "assumed_incident_cost_usd": float(assumption.assumed_incident_cost_usd),
        "confidence": float(assumption.confidence),
        "high_risk_threshold": int(assumption.high_risk_threshold),
        "enabled": bool(assumption.enabled),
        "updated_at": assumption.updated_at.isoformat() if assumption.updated_at else None,
    }


@router.put("/loss-assumptions")
def update_loss_assumptions(
    payload: dict,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _=Depends(require_roles("Admin")),
) -> dict:
    assumption = db.query(LossAssumption).filter(LossAssumption.organization_id == "org").first()
    if not assumption:
        assumption = LossAssumption(
            organization_id="org",
            assumed_incident_cost_usd=float(payload.get("assumed_incident_cost_usd", 25000)),
            confidence=float(payload.get("confidence", 0.35)),
            high_risk_threshold=int(payload.get("high_risk_threshold", 70)),
            enabled=bool(payload.get("enabled", True)),
            updated_by_user_id=user.id,
        )
        db.add(assumption)
    else:
        if "assumed_incident_cost_usd" in payload:
            assumption.assumed_incident_cost_usd = float(payload.get("assumed_incident_cost_usd"))
        if "confidence" in payload:
            assumption.confidence = float(payload.get("confidence"))
        if "high_risk_threshold" in payload:
            assumption.high_risk_threshold = int(payload.get("high_risk_threshold"))
        if "enabled" in payload:
            assumption.enabled = bool(payload.get("enabled"))
        assumption.updated_by_user_id = user.id
    db.commit()
    db.refresh(assumption)
    return {
        "organization_id": assumption.organization_id,
        "assumed_incident_cost_usd": float(assumption.assumed_incident_cost_usd),
        "confidence": float(assumption.confidence),
        "high_risk_threshold": int(assumption.high_risk_threshold),
        "enabled": bool(assumption.enabled),
        "updated_at": assumption.updated_at.isoformat() if assumption.updated_at else None,
    }


@router.get("/risk-over-time")
def get_risk_over_time(
    days: int = 7,
    db: Session = Depends(get_db),
    _=Depends(require_roles("Admin", "Security", "Auditor")),
) -> dict:
    now = datetime.now(timezone.utc)
    start = now - timedelta(days=days)
    
    rows = (
        db.query(
            func.date(AuditEvent.created_at).label("date"),
            func.avg(AuditEvent.risk_score).label("avg_risk"),
            func.max(AuditEvent.risk_score).label("max_risk"),
            func.count(AuditEvent.id).label("count"),
        )
        .filter(AuditEvent.created_at >= start)
        .group_by(func.date(AuditEvent.created_at))
        .order_by(func.date(AuditEvent.created_at).asc())
        .all()
    )
    
    return {
        "days": [
            {
                "date": row.date.isoformat() if row.date else None,
                "avg_risk": round(float(row.avg_risk), 1) if row.avg_risk else 0,
                "max_risk": int(row.max_risk) if row.max_risk else 0,
                "event_count": int(row.count),
            }
            for row in rows
        ]
    }
