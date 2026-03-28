from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends
from rq import Queue
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db, get_rq_queue, require_roles
from app.core.redis_client import get_raw_payload
from app.models.approval_request import ApprovalRequest
from app.models.tool_call import ToolCall
from app.models.user import User
from app.schemas.approval import ApprovalAction, ApprovalOut
from app.services.redaction import redact_data
from app.services.approval_service import approve_request, reject_request

router = APIRouter(prefix="/approvals", tags=["approvals"])


@router.get("", response_model=list[ApprovalOut])
def list_approvals(
    status: str | None = "pending",
    db: Session = Depends(get_db),
    _=Depends(require_roles("Admin", "Security", "Auditor", "Developer")),
) -> list[dict]:
    query = db.query(ApprovalRequest)
    if status:
        query = query.filter(ApprovalRequest.status == status)
    approvals = query.order_by(ApprovalRequest.created_at.desc()).all()
    tool_call_ids = [row.tool_call_id for row in approvals]
    tool_calls = (
        db.query(ToolCall)
        .filter(ToolCall.id.in_(tool_call_ids))
        .all()
        if tool_call_ids
        else []
    )
    tool_call_map = {row.id: row for row in tool_calls}

    rows: list[dict] = []
    for approval in approvals:
        tool_call = tool_call_map.get(approval.tool_call_id)
        request_redacted = (tool_call.request_json_redacted or {}) if tool_call else {}
        raw_payload = get_raw_payload(str(approval.tool_call_id)) or {}
        original_masked = redact_data(
            {
                "prompt": raw_payload.get("prompt"),
                "tool": raw_payload.get("tool"),
                "args": raw_payload.get("args", {}),
            }
        )
        args_redacted = request_redacted.get("args", {}) if isinstance(request_redacted, dict) else {}
        allowed_fields = {
            key: value
            for key, value in (args_redacted.items() if isinstance(args_redacted, dict) else [])
            if isinstance(value, (int, float, bool)) or (isinstance(value, str) and "[REDACTED" not in value)
        }

        rows.append(
            {
                "id": approval.id,
                "tool_call_id": approval.tool_call_id,
                "status": approval.status,
                "approver_user_id": approval.approver_user_id,
                "reason": approval.reason,
                "created_at": approval.created_at,
                "resolved_at": approval.resolved_at,
                "risk_score": tool_call.risk_score if tool_call else None,
                "decision_reason": tool_call.decision_reason if tool_call else None,
                "tool_name": (request_redacted.get("tool") if isinstance(request_redacted, dict) else None),
                "destination_domain": (request_redacted.get("destination_domain") if isinstance(request_redacted, dict) else None),
                "risk_breakdown": (request_redacted.get("risk_factors") if isinstance(request_redacted, dict) else None),
                "payload_preview": {
                    "original_masked": original_masked,
                    "redacted": request_redacted,
                    "allowed_fields": allowed_fields,
                },
            }
        )
    return rows


@router.post("/{approval_id}/approve", response_model=ApprovalOut)
def approve(
    approval_id: UUID,
    payload: ApprovalAction,
    db: Session = Depends(get_db),
    queue: Queue = Depends(get_rq_queue),
    user: User = Depends(get_current_user),
    _=Depends(require_roles("Admin", "Security", "Security_Approver")),
) -> ApprovalRequest:
    return approve_request(db=db, queue=queue, approval_id=approval_id, approver_id=user.id, reason=payload.reason)


@router.post("/{approval_id}/reject", response_model=ApprovalOut)
def reject(
    approval_id: UUID,
    payload: ApprovalAction,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _=Depends(require_roles("Admin", "Security", "Security_Approver")),
) -> ApprovalRequest:
    return reject_request(db=db, approval_id=approval_id, approver_id=user.id, reason=payload.reason)


@router.post("/batch-auto-approve")
def batch_auto_approve(
    db: Session = Depends(get_db),
    queue: Queue = Depends(get_rq_queue),
    user: User = Depends(get_current_user),
    _=Depends(require_roles("Admin", "Security")),
) -> dict:
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=24)
    
    low_risk_threshold = 30
    
    approvals_to_approve = (
        db.query(ApprovalRequest)
        .filter(ApprovalRequest.status == "pending")
        .filter(ApprovalRequest.created_at <= cutoff)
        .all()
    )
    
    tool_call_ids = [a.tool_call_id for a in approvals_to_approve]
    tool_calls = (
        db.query(ToolCall)
        .filter(ToolCall.id.in_(tool_call_ids))
        .all()
        if tool_call_ids
        else []
    )
    tool_call_map = {tc.id: tc for tc in tool_calls}
    
    approved_count = 0
    skipped_count = 0
    
    for approval in approvals_to_approve:
        tool_call = tool_call_map.get(approval.tool_call_id)
        if tool_call and tool_call.risk_score is not None and tool_call.risk_score <= low_risk_threshold:
            try:
                approve_request(
                    db=db,
                    queue=queue,
                    approval_id=approval.id,
                    approver_id=user.id,
                    reason="Auto-approved: Low risk (>24h old)",
                )
                approved_count += 1
            except Exception:
                skipped_count += 1
        else:
            skipped_count += 1
    
    return {
        "approved": approved_count,
        "skipped": skipped_count,
        "total_processed": len(approvals_to_approve),
    }
