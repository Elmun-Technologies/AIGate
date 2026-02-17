from fastapi import HTTPException
from rq import Queue
from sqlalchemy.orm import Session

from app.core.redis_client import set_raw_payload
from app.core.security import verify_api_key
from app.models.agent import Agent
from app.models.approval_request import ApprovalRequest
from app.models.policy import Policy
from app.models.tool import Tool
from app.models.tool_call import ToolCall
from app.schemas.gateway import ToolCallRequest
from app.services.audit_chain import append_audit_event
from app.services.policy_engine import evaluate_policy
from app.services.redaction import redact_data
from app.services.risk import calculate_risk
from app.services.spend import apply_spend_on_create, apply_spend_on_execute
from app.services.telemetry import upsert_tool_call_usage_event
from app.services.tool_executor import execute_tool_call

PENDING_APPROVAL_JOB = "app.worker_tasks.pending_approval_notification"
AGGREGATE_SPEND_JOB = "app.worker_tasks.aggregate_spend_task"
EVALUATE_ALERTS_JOB = "app.worker_tasks.evaluate_alerts_task"


def _normalize_payload(request: ToolCallRequest) -> tuple[str, str, dict]:
    tool_name = request.tool.strip()
    prompt = request.prompt or ""
    args = request.args or {}
    return tool_name, prompt, args


def _active_policy(db: Session) -> Policy | None:
    return db.query(Policy).filter(Policy.is_active.is_(True)).order_by(Policy.created_at.desc()).first()


def _enqueue_spend_jobs(queue: Queue) -> None:
    queue.enqueue(AGGREGATE_SPEND_JOB)
    queue.enqueue(EVALUATE_ALERTS_JOB)


def process_gateway_tool_call(db: Session, queue: Queue, request: ToolCallRequest) -> dict:
    tool_name, prompt, args = _normalize_payload(request)

    agent = db.query(Agent).filter(Agent.id == request.agent_id).first()
    if not agent:
        raise HTTPException(status_code=401, detail="Invalid agent credentials")
    if not verify_api_key(request.agent_api_key, agent.api_key_hash):
        raise HTTPException(status_code=401, detail="Invalid agent credentials")
    if agent.status.lower() != "active":
        raise HTTPException(status_code=403, detail="Agent is not active")

    tool = db.query(Tool).filter(Tool.name == tool_name).first()
    if not tool:
        raise HTTPException(status_code=404, detail=f"Unknown tool: {tool_name}")

    risk_score = calculate_risk(tool.risk_level, prompt, agent.data_classification)
    context = {
        "tool": tool_name,
        "prompt": prompt,
        "agent_data_classification": agent.data_classification,
        "risk_score": risk_score,
    }

    decision = "ALLOW"
    reason = "Default allow"
    matched_rule = "default"

    policy = _active_policy(db)
    if policy:
        decision, reason, matched_rule = evaluate_policy(policy.yaml_text, context)

    if decision != "BLOCK" and risk_score >= 80 and decision != "REQUIRE_APPROVAL":
        decision = "REQUIRE_APPROVAL"
        reason = "Risk score >= 80"
        matched_rule = "risk-override"

    redacted_request = redact_data(
        {
            "prompt": prompt,
            "tool": tool_name,
            "args": args,
        }
    )

    status = "pending"
    if decision == "BLOCK":
        status = "blocked"
    elif decision == "ALLOW":
        status = "allowed"

    tool_call = ToolCall(
        agent_id=agent.id,
        tool_id=tool.id,
        request_json_redacted=redacted_request,
        status=status,
        risk_score=risk_score,
        decision_reason=reason,
    )
    apply_spend_on_create(tool_call, prompt=prompt, args=args)
    db.add(tool_call)
    db.flush()

    set_raw_payload(
        str(tool_call.id),
        {
            "prompt": prompt,
            "tool": tool_name,
            "args": args,
        },
    )

    append_audit_event(
        db=db,
        stream_id=str(agent.id),
        event_type="TOOL_CALL_EVALUATED",
        payload_redacted_json=redact_data(
            {
                "tool_call_id": str(tool_call.id),
                "request": redacted_request,
                "decision_reason": reason,
                "policy_rule": matched_rule,
            }
        ),
        decision=decision,
        risk_score=risk_score,
    )

    if decision == "BLOCK":
        tool_call.status = "blocked"
        upsert_tool_call_usage_event(db, tool_call=tool_call, api_key_fingerprint=agent.api_key_hash, source_hint="backend")
        db.commit()
        _enqueue_spend_jobs(queue)
        return {
            "status": "blocked",
            "tool_call_id": tool_call.id,
            "risk_score": risk_score,
            "decision_reason": reason,
            "result": None,
        }

    if decision == "REQUIRE_APPROVAL":
        approval = ApprovalRequest(tool_call_id=tool_call.id, status="pending")
        db.add(approval)
        db.flush()

        append_audit_event(
            db=db,
            stream_id=str(agent.id),
            event_type="APPROVAL_REQUESTED",
            payload_redacted_json=redact_data(
                {
                    "tool_call_id": str(tool_call.id),
                    "approval_request_id": str(approval.id),
                    "request": redacted_request,
                }
            ),
            decision="REQUIRE_APPROVAL",
            risk_score=risk_score,
        )

        upsert_tool_call_usage_event(db, tool_call=tool_call, api_key_fingerprint=agent.api_key_hash, source_hint="backend")
        db.commit()
        queue.enqueue(PENDING_APPROVAL_JOB, str(approval.id))
        _enqueue_spend_jobs(queue)
        return {
            "status": "pending_approval",
            "tool_call_id": tool_call.id,
            "approval_request_id": approval.id,
            "risk_score": risk_score,
            "decision_reason": reason,
            "result": None,
        }

    execution_result = execute_tool_call(tool, args)
    tool_call.status = "executed"
    tool_call.response_json_redacted = redact_data(execution_result)
    apply_spend_on_execute(tool_call, prompt=prompt, args=args, response=execution_result)
    upsert_tool_call_usage_event(db, tool_call=tool_call, api_key_fingerprint=agent.api_key_hash, source_hint="backend")

    append_audit_event(
        db=db,
        stream_id=str(agent.id),
        event_type="TOOL_EXECUTED",
        payload_redacted_json=redact_data(
            {
                "tool_call_id": str(tool_call.id),
                "request": redacted_request,
                "response": execution_result,
            }
        ),
        decision="ALLOW",
        risk_score=risk_score,
    )

    db.commit()
    _enqueue_spend_jobs(queue)
    return {
        "status": "executed",
        "tool_call_id": tool_call.id,
        "risk_score": risk_score,
        "decision_reason": reason,
        "result": execution_result,
    }
