from datetime import datetime, timezone
from uuid import UUID
from uuid import uuid4

from fastapi import HTTPException
from rq import Queue
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.redis_client import get_raw_payload, set_raw_payload
from app.models.approval_request import ApprovalRequest
from app.models.tool_call import ToolCall
from app.services.audit_chain import append_audit_event
from app.services.redaction import redact_data
from app.services.runtime_authority import attach_runtime_authority, issue_runtime_token


EXECUTION_JOB = "app.worker_tasks.execute_tool_call_task"


def approve_request(db: Session, queue: Queue, approval_id: UUID, approver_id: UUID, reason: str) -> ApprovalRequest:
    approval = db.query(ApprovalRequest).filter(ApprovalRequest.id == approval_id).first()
    if not approval:
        raise HTTPException(status_code=404, detail="Approval request not found")
    if approval.status != "pending":
        raise HTTPException(status_code=400, detail="Approval request is not pending")

    tool_call = db.query(ToolCall).filter(ToolCall.id == approval.tool_call_id).first()
    if not tool_call:
        raise HTTPException(status_code=404, detail="Associated tool call not found")

    approval.status = "approved"
    approval.approver_user_id = approver_id
    approval.reason = reason
    approval.resolved_at = datetime.now(timezone.utc)

    tool_call.status = "allowed"
    tool_call.decision_reason = f"Approved: {reason}"

    runtime_nonce = uuid4().hex
    runtime_token, runtime_payload = issue_runtime_token(
        tool_call_id=str(tool_call.id),
        agent_id=str(tool_call.agent_id),
        tool_name=str((tool_call.request_json_redacted or {}).get("tool") or "unknown"),
        nonce=runtime_nonce,
        ttl_seconds=settings.RUNTIME_TOKEN_TTL_SECONDS,
    )
    attach_runtime_authority(tool_call, token=runtime_token, payload=runtime_payload)
    raw = get_raw_payload(str(tool_call.id)) or {}
    set_raw_payload(
        str(tool_call.id),
        {
            "prompt": raw.get("prompt", ""),
            "tool": raw.get("tool") or (tool_call.request_json_redacted or {}).get("tool"),
            "args": raw.get("args") or {},
            "runtime_token": runtime_token,
            "session_id": raw.get("session_id"),
        },
    )

    append_audit_event(
        db=db,
        stream_id=str(tool_call.agent_id),
        event_type="APPROVAL_DECISION",
        payload_redacted_json=redact_data(
            {
                "approval_request_id": str(approval.id),
                "tool_call_id": str(tool_call.id),
                "action": "approve",
                "reason": reason,
            }
        ),
        decision="ALLOW",
        risk_score=tool_call.risk_score,
    )
    append_audit_event(
        db=db,
        stream_id=str(tool_call.agent_id),
        event_type="RUNTIME_AUTH_ISSUED",
        payload_redacted_json=redact_data(
            {
                "tool_call_id": str(tool_call.id),
                "approval_request_id": str(approval.id),
                "authorization_mode": "runtime_token",
                "nonce": runtime_nonce,
            }
        ),
        decision="ALLOW",
        risk_score=tool_call.risk_score,
    )

    db.commit()
    queue.enqueue(EXECUTION_JOB, str(tool_call.id))
    return approval


def reject_request(db: Session, approval_id: UUID, approver_id: UUID, reason: str) -> ApprovalRequest:
    approval = db.query(ApprovalRequest).filter(ApprovalRequest.id == approval_id).first()
    if not approval:
        raise HTTPException(status_code=404, detail="Approval request not found")
    if approval.status != "pending":
        raise HTTPException(status_code=400, detail="Approval request is not pending")

    tool_call = db.query(ToolCall).filter(ToolCall.id == approval.tool_call_id).first()
    if not tool_call:
        raise HTTPException(status_code=404, detail="Associated tool call not found")

    approval.status = "rejected"
    approval.approver_user_id = approver_id
    approval.reason = reason
    approval.resolved_at = datetime.now(timezone.utc)

    tool_call.status = "blocked"
    tool_call.decision_reason = f"Rejected: {reason}"

    append_audit_event(
        db=db,
        stream_id=str(tool_call.agent_id),
        event_type="APPROVAL_DECISION",
        payload_redacted_json=redact_data(
            {
                "approval_request_id": str(approval.id),
                "tool_call_id": str(tool_call.id),
                "action": "reject",
                "reason": reason,
            }
        ),
        decision="BLOCK",
        risk_score=tool_call.risk_score,
    )

    db.commit()
    return approval
