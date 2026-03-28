from __future__ import annotations

from typing import Any

from app.models.approval_request import ApprovalRequest
from app.models.audit_event import AuditEvent
from app.models.policy import Policy
from app.models.tool_call import ToolCall
from app.services.audit_integrity import verify_audit_rows


def extract_tool_call_id(payload: dict[str, Any]) -> str | None:
    if not isinstance(payload, dict):
        return None
    value = payload.get("tool_call_id")
    if value:
        return str(value)
    request = payload.get("request")
    if isinstance(request, dict) and request.get("tool_call_id"):
        return str(request.get("tool_call_id"))
    return None


def build_audit_pack(
    *,
    session_id: str | None,
    tool_calls: list[ToolCall],
    audit_events: list[AuditEvent],
    approvals: list[ApprovalRequest],
    active_policy: Policy | None,
) -> dict[str, Any]:
    if session_id:
        session_calls = [
            row
            for row in tool_calls
            if isinstance(row.request_json_redacted, dict)
            and str(row.request_json_redacted.get("session_id") or "") == session_id
        ]
    else:
        session_calls = list(tool_calls)

    call_id_set = {str(row.id) for row in session_calls}
    session_events = [
        row for row in audit_events if extract_tool_call_id(row.payload_redacted_json or {}) in call_id_set
    ]
    session_approvals = [
        row for row in approvals if str(row.tool_call_id) in call_id_set
    ]
    chain_verification = verify_audit_rows(
        sorted(
            session_events,
            key=lambda row: (
                row.stream_id or "",
                row.created_at.isoformat() if row.created_at else "",
                str(row.id),
            ),
        )
    )

    timeline = []
    for tool_call in sorted(
        session_calls,
        key=lambda row: (row.created_at.isoformat() if row.created_at else "", str(row.id)),
    ):
        timeline.append(
            {
                "tool_call_id": str(tool_call.id),
                "agent_id": str(tool_call.agent_id),
                "tool_id": str(tool_call.tool_id),
                "status": tool_call.status,
                "risk_score": int(tool_call.risk_score),
                "decision_reason": tool_call.decision_reason,
                "created_at": tool_call.created_at.isoformat() if tool_call.created_at else None,
                "request_json_redacted": tool_call.request_json_redacted,
                "response_json_redacted": tool_call.response_json_redacted,
            }
        )

    return {
        "session_id": session_id,
        "timeline": timeline,
        "tool_calls": [
            {
                "id": str(row.id),
                "agent_id": str(row.agent_id),
                "tool_id": str(row.tool_id),
                "status": row.status,
                "risk_score": int(row.risk_score),
                "decision_reason": row.decision_reason,
                "request_json_redacted": row.request_json_redacted,
                "response_json_redacted": row.response_json_redacted,
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
            for row in session_calls
        ],
        "audit_events": [
            {
                "id": str(row.id),
                "stream_id": row.stream_id,
                "event_type": row.event_type,
                "decision": row.decision,
                "risk_score": int(row.risk_score),
                "prev_hash": row.prev_hash,
                "chain_hash": row.chain_hash,
                "payload_redacted_json": row.payload_redacted_json,
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
            for row in session_events
        ],
        "approvals": [
            {
                "id": str(row.id),
                "tool_call_id": str(row.tool_call_id),
                "status": row.status,
                "approver_user_id": str(row.approver_user_id) if row.approver_user_id else None,
                "reason": row.reason,
                "created_at": row.created_at.isoformat() if row.created_at else None,
                "resolved_at": row.resolved_at.isoformat() if row.resolved_at else None,
            }
            for row in session_approvals
        ],
        "policy_snapshot": (
            {
                "id": str(active_policy.id),
                "name": active_policy.name,
                "version": active_policy.version,
                "yaml_text": active_policy.yaml_text,
                "is_active": active_policy.is_active,
                "created_at": active_policy.created_at.isoformat() if active_policy.created_at else None,
            }
            if active_policy
            else None
        ),
        "verification_report": {
            "chain_valid": bool(chain_verification["valid"]),
            "checked_streams": int(chain_verification["checked_streams"]),
            "checked_events": int(chain_verification["checked_events"]),
            "issues_count": int(chain_verification["issues_count"]),
            "issues": chain_verification.get("issues", []),
        },
    }
