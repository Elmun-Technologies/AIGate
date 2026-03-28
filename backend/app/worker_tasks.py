from datetime import date, datetime, timezone

from sqlalchemy.orm import Session

from app.core.redis_client import get_queue, get_raw_payload
from app.db.session import SessionLocal
from app.models.agent import Agent
from app.models.tool import Tool
from app.models.tool_call import ToolCall
from app.services.alert_engine import evaluate_alert_rules
from app.services.audit_anchoring import anchor_audit_day
from app.services.audit_chain import append_audit_event
from app.services.redaction import redact_data
from app.services.runtime_authority import verify_runtime_token
from app.services.shadow_ai_detector import analyze_tool_call, run_governance_cycle
from app.services.spend import apply_spend_on_execute
from app.services.spend_aggregation import aggregate_spend_data
from app.services.telemetry import upsert_tool_call_usage_event
from app.services.tool_executor import execute_tool_call


def pending_approval_notification(approval_request_id: str) -> dict:
    return {
        "status": "queued",
        "approval_request_id": approval_request_id,
    }


def execute_tool_call_task(tool_call_id: str) -> dict:
    db: Session = SessionLocal()
    try:
        tool_call = db.query(ToolCall).filter(ToolCall.id == tool_call_id).first()
        if not tool_call:
            return {"status": "missing-tool-call", "tool_call_id": tool_call_id}

        tool = db.query(Tool).filter(Tool.id == tool_call.tool_id).first()
        if not tool:
            tool_call.status = "blocked"
            tool_call.decision_reason = "Tool no longer exists"
            db.commit()
            return {"status": "missing-tool", "tool_call_id": tool_call_id}

        raw = get_raw_payload(str(tool_call.id))
        if not raw:
            tool_call.status = "blocked"
            tool_call.decision_reason = "Raw payload expired before execution"

            append_audit_event(
                db=db,
                stream_id=str(tool_call.agent_id),
                event_type="TOOL_EXECUTION_FAILED",
                payload_redacted_json=redact_data(
                    {
                        "tool_call_id": str(tool_call.id),
                        "reason": "Raw payload expired before execution",
                    }
                ),
                decision="BLOCK",
                risk_score=tool_call.risk_score,
            )
            db.commit()
            return {"status": "raw-payload-missing", "tool_call_id": tool_call_id}

        runtime_token = str(raw.get("runtime_token") or "")
        tool_name = str((raw or {}).get("tool") or tool.name)
        is_valid, runtime_reason = verify_runtime_token(
            tool_call,
            token=runtime_token,
            expected_tool=tool_name,
        )
        if not is_valid:
            tool_call.status = "blocked"
            tool_call.decision_reason = f"Runtime authorization failed: {runtime_reason}"
            append_audit_event(
                db=db,
                stream_id=str(tool_call.agent_id),
                event_type="RUNTIME_AUTH_FAILED",
                payload_redacted_json=redact_data(
                    {
                        "tool_call_id": str(tool_call.id),
                        "reason": runtime_reason,
                        "async": True,
                    }
                ),
                decision="BLOCK",
                risk_score=tool_call.risk_score,
            )
            db.commit()
            return {"status": "runtime-auth-failed", "tool_call_id": tool_call_id}

        append_audit_event(
            db=db,
            stream_id=str(tool_call.agent_id),
            event_type="RUNTIME_AUTH_VERIFIED",
            payload_redacted_json=redact_data(
                {
                    "tool_call_id": str(tool_call.id),
                    "authorization_mode": "runtime_token",
                    "async": True,
                }
            ),
            decision="ALLOW",
            risk_score=tool_call.risk_score,
        )

        result = execute_tool_call(tool, raw.get("args", {}))
        tool_call.status = "executed"
        tool_call.response_json_redacted = redact_data(result)
        tool_call.execution_attested_at = datetime.now(timezone.utc)
        apply_spend_on_execute(
            tool_call,
            prompt=str(raw.get("prompt") or ""),
            args=raw.get("args") or {},
            response=result,
        )
        api_key_fingerprint = None
        agent = db.query(Agent).filter(Agent.id == tool_call.agent_id).first()
        if agent:
            api_key_fingerprint = agent.api_key_hash
        analyze_tool_call(
            db,
            tool_call=tool_call,
            agent=agent,
            tool_name=str((raw or {}).get("tool") or "unknown"),
            args=(raw or {}).get("args") or {},
            prompt=str((raw or {}).get("prompt") or ""),
            response=result,
            fallback_provider=tool_call.provider,
            source_hint="proxy",
        )
        upsert_tool_call_usage_event(db, tool_call=tool_call, api_key_fingerprint=api_key_fingerprint, source_hint="backend")

        append_audit_event(
            db=db,
            stream_id=str(tool_call.agent_id),
            event_type="TOOL_EXECUTED",
            payload_redacted_json=redact_data(
                {
                    "tool_call_id": str(tool_call.id),
                    "request": tool_call.request_json_redacted,
                    "response": result,
                    "async": True,
                }
            ),
            decision="ALLOW",
            risk_score=tool_call.risk_score,
        )
        db.commit()
        # Keep spend aggregate and alert evaluation asynchronous after execution.
        rq_queue = get_queue()
        rq_queue.enqueue("app.worker_tasks.aggregate_spend_task")
        rq_queue.enqueue("app.worker_tasks.evaluate_alerts_task")
        rq_queue.enqueue("app.worker_tasks.run_ai_governance_cycle_task")
        rq_queue.enqueue("app.worker_tasks.run_audit_anchor_task")
        return {"status": "executed", "tool_call_id": tool_call_id, "result": result}
    finally:
        db.close()


def aggregate_spend_task() -> dict:
    db: Session = SessionLocal()
    try:
        return aggregate_spend_data(db)
    finally:
        db.close()


def evaluate_alerts_task() -> dict:
    db: Session = SessionLocal()
    try:
        return evaluate_alert_rules(db)
    finally:
        db.close()


def run_ai_governance_cycle_task() -> dict:
    db: Session = SessionLocal()
    try:
        return run_governance_cycle(db)
    finally:
        db.close()


def run_audit_anchor_task(anchor_date: str | None = None) -> dict:
    db: Session = SessionLocal()
    try:
        day = date.fromisoformat(anchor_date) if anchor_date else datetime.now(timezone.utc).date()
        anchor = anchor_audit_day(db, day=day)
        db.commit()
        return {
            "status": "anchored",
            "anchor_date": anchor.anchor_date.isoformat(),
            "merkle_root": anchor.merkle_root,
            "leaf_count": int(anchor.leaf_count),
            "anchor_ref": anchor.anchor_ref,
        }
    finally:
        db.close()
