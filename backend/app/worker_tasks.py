from sqlalchemy.orm import Session

from app.core.redis_client import get_queue, get_raw_payload
from app.db.session import SessionLocal
from app.models.agent import Agent
from app.models.tool import Tool
from app.models.tool_call import ToolCall
from app.services.alert_engine import evaluate_alert_rules
from app.services.audit_chain import append_audit_event
from app.services.redaction import redact_data
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

        result = execute_tool_call(tool, raw.get("args", {}))
        tool_call.status = "executed"
        tool_call.response_json_redacted = redact_data(result)
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
