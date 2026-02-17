from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_roles
from app.models.agent import Agent
from app.models.approval_request import ApprovalRequest
from app.models.tool_call import ToolCall

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
