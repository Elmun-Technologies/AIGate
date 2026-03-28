from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi import HTTPException
from rq import Queue
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.redis_client import set_raw_payload
from app.core.security import verify_api_key
from app.models.agent import Agent
from app.models.approval_request import ApprovalRequest
from app.models.policy import Policy
from app.models.tool import Tool
from app.models.tool_call import ToolCall
from app.schemas.gateway import ToolCallRequest
from app.services.audit_chain import append_audit_event
from app.services.policy_runtime import evaluate_policy_runtime
from app.services.redaction import redact_data
from app.services.risk import calculate_risk_with_breakdown
from app.services.runtime_authority import attach_runtime_authority, issue_runtime_token, verify_runtime_token
from app.services.shadow_ai_detector import analyze_tool_call
from app.services.spend import apply_spend_on_create, apply_spend_on_execute
from app.services.telemetry import upsert_tool_call_usage_event
from app.services.tool_executor import execute_tool_call

PENDING_APPROVAL_JOB = "app.worker_tasks.pending_approval_notification"
AGGREGATE_SPEND_JOB = "app.worker_tasks.aggregate_spend_task"
EVALUATE_ALERTS_JOB = "app.worker_tasks.evaluate_alerts_task"
GOVERNANCE_CYCLE_JOB = "app.worker_tasks.run_ai_governance_cycle_task"
ANCHOR_AUDIT_JOB = "app.worker_tasks.run_audit_anchor_task"


def _normalize_payload(request: ToolCallRequest) -> tuple[str, str, dict, str | None]:
    tool_name = request.tool.strip()
    prompt = request.prompt or ""
    raw_args = request.args or {}
    session_id = str(raw_args.get("__session_id")).strip() if raw_args.get("__session_id") else None
    args = {k: v for k, v in raw_args.items() if not str(k).startswith("__")}
    return tool_name, prompt, args, session_id


def _active_policy(db: Session) -> Policy | None:
    return db.query(Policy).filter(Policy.is_active.is_(True)).order_by(Policy.created_at.desc()).first()


def _enqueue_spend_jobs(queue: Queue) -> None:
    queue.enqueue(AGGREGATE_SPEND_JOB)
    queue.enqueue(EVALUATE_ALERTS_JOB)


def _enqueue_governance_jobs(queue: Queue) -> None:
    queue.enqueue(GOVERNANCE_CYCLE_JOB)
    queue.enqueue(ANCHOR_AUDIT_JOB)


def process_gateway_tool_call(db: Session, queue: Queue, request: ToolCallRequest) -> dict:
    tool_name, prompt, args, session_id = _normalize_payload(request)

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

    now = datetime.now(timezone.utc)
    recent_window_start = now - timedelta(hours=1)
    baseline_window_start = now - timedelta(hours=7)
    recent_count = (
        db.query(func.count(ToolCall.id))
        .filter(ToolCall.agent_id == agent.id, ToolCall.created_at >= recent_window_start)
        .scalar()
        or 0
    )
    baseline_count = (
        db.query(func.count(ToolCall.id))
        .filter(
            ToolCall.agent_id == agent.id,
            ToolCall.created_at >= baseline_window_start,
            ToolCall.created_at < recent_window_start,
        )
        .scalar()
        or 0
    )
    baseline_avg = float(baseline_count) / 6.0 if baseline_count else 0.0
    spend_spike = bool(recent_count >= 3 and (baseline_avg == 0 or recent_count > baseline_avg * 3.0))

    risk_info = calculate_risk_with_breakdown(
        tool_name=tool_name,
        tool_risk_level=tool.risk_level,
        prompt=prompt,
        args=args,
        agent_classification=agent.data_classification,
        destination_allowlist=set(settings.DESTINATION_ALLOWLIST),
        spend_spike=spend_spike,
        owner_missing=not bool((agent.owner_email or "").strip()),
    )
    risk_score = int(risk_info["score"])

    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    spend_agent_day_usd = (
        db.query(func.coalesce(func.sum(ToolCall.cost_usd), 0))
        .filter(ToolCall.agent_id == agent.id, ToolCall.created_at >= today_start)
        .scalar()
    )
    context = {
        "tool": tool_name,
        "prompt": prompt,
        "agent_data_classification": agent.data_classification,
        "risk_score": risk_score,
        "payload_contains_pii": bool(risk_info["payload_contains_pii"]),
        "destination_domain": risk_info["destination_domain"] or "",
        "destination_domain_in": settings.DESTINATION_ALLOWLIST,
        "destination_allowlisted": bool(
            risk_info["destination_domain"]
            and str(risk_info["destination_domain"]).lower() in {item.lower() for item in settings.DESTINATION_ALLOWLIST}
        ),
        "spend_agent_day_usd": float(spend_agent_day_usd or 0),
        "owner_missing": not bool((agent.owner_email or "").strip()),
        "session_id": session_id,
    }

    decision = "REQUIRE_APPROVAL"
    reason = "Safe default: explicit allow required"
    matched_rule = "safe-default"

    policy = _active_policy(db)
    if policy:
        decision, reason, matched_rule, policy_source = evaluate_policy_runtime(policy.yaml_text, context)
        matched_rule = f"{policy_source}:{matched_rule}"

    if decision != "BLOCK" and risk_score >= 80 and decision != "REQUIRE_APPROVAL":
        decision = "REQUIRE_APPROVAL"
        reason = "Risk score >= 80"
        matched_rule = "risk-override"

    redacted_request = redact_data(
        {
            "prompt": prompt,
            "tool": tool_name,
            "args": args,
            "session_id": session_id,
            "risk_factors": risk_info["factors"],
            "risk_score": risk_score,
            "destination_domain": risk_info["destination_domain"],
            "payload_contains_pii": risk_info["payload_contains_pii"],
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
            "session_id": session_id,
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
                "risk_breakdown": risk_info["factors"],
                "destination_domain": risk_info["destination_domain"],
            }
        ),
        decision=decision,
        risk_score=risk_score,
    )

    if decision == "BLOCK":
        tool_call.status = "blocked"
        analyze_tool_call(
            db,
            tool_call=tool_call,
            agent=agent,
            tool_name=tool_name,
            args=args,
            prompt=prompt,
            response=None,
            fallback_provider=tool_call.provider,
            source_hint="proxy",
        )
        upsert_tool_call_usage_event(db, tool_call=tool_call, api_key_fingerprint=agent.api_key_hash, source_hint="backend")
        db.commit()
        _enqueue_spend_jobs(queue)
        _enqueue_governance_jobs(queue)
        return {
            "status": "blocked",
            "tool_call_id": tool_call.id,
            "risk_score": risk_score,
            "decision_reason": reason,
            "risk_breakdown": risk_info["factors"],
            "destination_domain": risk_info["destination_domain"],
            "result": None,
            "runtime_token": None,
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

        analyze_tool_call(
            db,
            tool_call=tool_call,
            agent=agent,
            tool_name=tool_name,
            args=args,
            prompt=prompt,
            response=None,
            fallback_provider=tool_call.provider,
            source_hint="proxy",
        )
        upsert_tool_call_usage_event(db, tool_call=tool_call, api_key_fingerprint=agent.api_key_hash, source_hint="backend")
        db.commit()
        queue.enqueue(PENDING_APPROVAL_JOB, str(approval.id))
        _enqueue_spend_jobs(queue)
        _enqueue_governance_jobs(queue)
        return {
            "status": "pending_approval",
            "tool_call_id": tool_call.id,
            "approval_request_id": approval.id,
            "risk_score": risk_score,
            "decision_reason": reason,
            "risk_breakdown": risk_info["factors"],
            "destination_domain": risk_info["destination_domain"],
            "result": None,
            "runtime_token": None,
        }

    runtime_nonce = uuid4().hex
    runtime_token, runtime_payload = issue_runtime_token(
        tool_call_id=str(tool_call.id),
        agent_id=str(agent.id),
        tool_name=tool_name,
        nonce=runtime_nonce,
        ttl_seconds=settings.RUNTIME_TOKEN_TTL_SECONDS,
    )
    attach_runtime_authority(tool_call, token=runtime_token, payload=runtime_payload)
    set_raw_payload(
        str(tool_call.id),
        {
            "prompt": prompt,
            "tool": tool_name,
            "args": args,
            "runtime_token": runtime_token,
            "session_id": session_id,
        },
    )
    is_valid, runtime_reason = verify_runtime_token(tool_call, token=runtime_token, expected_tool=tool_name)
    if not is_valid:
        tool_call.status = "blocked"
        tool_call.decision_reason = f"Runtime authorization failed: {runtime_reason}"
        append_audit_event(
            db=db,
            stream_id=str(agent.id),
            event_type="RUNTIME_AUTH_FAILED",
            payload_redacted_json=redact_data(
                {
                    "tool_call_id": str(tool_call.id),
                    "reason": runtime_reason,
                }
            ),
            decision="BLOCK",
            risk_score=risk_score,
        )
        db.commit()
        _enqueue_spend_jobs(queue)
        _enqueue_governance_jobs(queue)
        return {
            "status": "blocked",
            "tool_call_id": tool_call.id,
            "risk_score": risk_score,
            "decision_reason": tool_call.decision_reason,
            "risk_breakdown": risk_info["factors"],
            "destination_domain": risk_info["destination_domain"],
            "result": None,
            "runtime_token": None,
        }

    append_audit_event(
        db=db,
        stream_id=str(agent.id),
        event_type="RUNTIME_AUTH_VERIFIED",
        payload_redacted_json=redact_data(
            {
                "tool_call_id": str(tool_call.id),
                "nonce": runtime_nonce,
                "authorization_mode": "runtime_token",
                "risk_breakdown": risk_info["factors"],
            }
        ),
        decision="ALLOW",
        risk_score=risk_score,
    )
    execution_result = execute_tool_call(tool, args)
    tool_call.status = "executed"
    tool_call.response_json_redacted = redact_data(execution_result)
    tool_call.execution_attested_at = datetime.now(timezone.utc)
    apply_spend_on_execute(tool_call, prompt=prompt, args=args, response=execution_result)
    analyze_tool_call(
        db,
        tool_call=tool_call,
        agent=agent,
        tool_name=tool_name,
        args=args,
        prompt=prompt,
        response=execution_result,
        fallback_provider=tool_call.provider,
        source_hint="proxy",
    )
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
                "risk_breakdown": risk_info["factors"],
            }
        ),
        decision="ALLOW",
        risk_score=risk_score,
    )

    db.commit()
    _enqueue_spend_jobs(queue)
    _enqueue_governance_jobs(queue)
    return {
        "status": "executed",
        "tool_call_id": tool_call.id,
        "risk_score": risk_score,
        "decision_reason": reason,
        "risk_breakdown": risk_info["factors"],
        "destination_domain": risk_info["destination_domain"],
        "result": execution_result,
        "runtime_token": runtime_token,
    }
