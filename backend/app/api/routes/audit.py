import csv
from datetime import datetime
from io import StringIO
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_roles
from app.models.audit_event import AuditEvent
from app.schemas.audit import AuditEventOut

router = APIRouter(tags=["audit"])


def _extract_tool_call_id(payload: dict) -> str | None:
    value = payload.get("tool_call_id")
    if value:
        return str(value)
    request = payload.get("request")
    if isinstance(request, dict):
        req_value = request.get("tool_call_id")
        if req_value:
            return str(req_value)
    return None


def _extract_approval_id(payload: dict) -> str | None:
    value = payload.get("approval_request_id")
    if value:
        return str(value)
    return None


def _extract_tool_name(payload: dict) -> str | None:
    request = payload.get("request")
    if isinstance(request, dict) and request.get("tool"):
        return str(request.get("tool"))
    return None


def _extract_reason(payload: dict) -> str | None:
    for key in ("decision_reason", "reason"):
        value = payload.get(key)
        if isinstance(value, str) and value:
            return value
    return None


@router.get("/audit", response_model=list[AuditEventOut])
def list_audit_events(
    agent_id: str | None = None,
    decision: str | None = None,
    min_risk: int | None = None,
    max_risk: int | None = None,
    from_: datetime | None = Query(default=None, alias="from"),
    to: datetime | None = None,
    db: Session = Depends(get_db),
    _=Depends(require_roles("Admin", "Security", "Auditor")),
) -> list[AuditEvent]:
    query = db.query(AuditEvent)

    if agent_id:
        query = query.filter(AuditEvent.stream_id == agent_id)
    if decision:
        query = query.filter(AuditEvent.decision == decision)
    if min_risk is not None:
        query = query.filter(AuditEvent.risk_score >= min_risk)
    if max_risk is not None:
        query = query.filter(AuditEvent.risk_score <= max_risk)
    if from_ is not None:
        query = query.filter(AuditEvent.created_at >= from_)
    if to is not None:
        query = query.filter(AuditEvent.created_at <= to)

    return query.order_by(AuditEvent.created_at.desc()).limit(500).all()


@router.get("/audit/export")
def export_audit_events(
    format: str = "json",
    agent_id: str | None = None,
    decision: str | None = None,
    min_risk: int | None = None,
    max_risk: int | None = None,
    from_: datetime | None = Query(default=None, alias="from"),
    to: datetime | None = None,
    db: Session = Depends(get_db),
    _=Depends(require_roles("Admin", "Security", "Auditor")),
) -> Response:
    query = db.query(AuditEvent)

    if agent_id:
        query = query.filter(AuditEvent.stream_id == agent_id)
    if decision:
        query = query.filter(AuditEvent.decision == decision)
    if min_risk is not None:
        query = query.filter(AuditEvent.risk_score >= min_risk)
    if max_risk is not None:
        query = query.filter(AuditEvent.risk_score <= max_risk)
    if from_ is not None:
        query = query.filter(AuditEvent.created_at >= from_)
    if to is not None:
        query = query.filter(AuditEvent.created_at <= to)

    events = query.order_by(AuditEvent.created_at.asc()).limit(1000).all()
    rows = [
        {
            "id": str(event.id),
            "stream_id": event.stream_id,
            "event_type": event.event_type,
            "decision": event.decision,
            "risk_score": event.risk_score,
            "prev_hash": event.prev_hash,
            "chain_hash": event.chain_hash,
            "payload_redacted_json": event.payload_redacted_json,
            "created_at": event.created_at.isoformat() if event.created_at else None,
            "tool_call_id": _extract_tool_call_id(event.payload_redacted_json or {}),
            "approval_request_id": _extract_approval_id(event.payload_redacted_json or {}),
            "tool": _extract_tool_name(event.payload_redacted_json or {}),
            "reason": _extract_reason(event.payload_redacted_json or {}),
        }
        for event in events
    ]

    grouped_chains: dict[str, dict] = {}
    for row in rows:
        tool_call_id = row["tool_call_id"]
        if not tool_call_id:
            continue
        if tool_call_id not in grouped_chains:
            grouped_chains[tool_call_id] = {
                "tool_call_id": tool_call_id,
                "agent_id": row["stream_id"],
                "tool": row["tool"],
                "final_decision": row["decision"],
                "max_risk": row["risk_score"],
                "approval_request_id": row["approval_request_id"],
                "events": [],
            }

        chain = grouped_chains[tool_call_id]
        chain["tool"] = chain["tool"] or row["tool"]
        chain["final_decision"] = row["decision"]
        chain["max_risk"] = max(int(chain["max_risk"]), int(row["risk_score"]))
        chain["approval_request_id"] = chain["approval_request_id"] or row["approval_request_id"]
        chain["events"].append(
            {
                "id": row["id"],
                "time": row["created_at"],
                "type": row["event_type"],
                "decision": row["decision"],
                "risk_score": row["risk_score"],
                "reason": row["reason"],
                "approval_request_id": row["approval_request_id"],
            }
        )

    fmt = format.lower()
    if fmt == "json":
        return JSONResponse(
            content={
                "format": "json",
                "count": len(rows),
                "events": rows,
                "grouped_chains": list(grouped_chains.values()),
            }
        )
    if fmt == "csv":
        buffer = StringIO()
        writer = csv.DictWriter(
            buffer,
            fieldnames=[
                "created_at",
                "id",
                "stream_id",
                "tool_call_id",
                "approval_request_id",
                "tool",
                "event_type",
                "decision",
                "risk_score",
                "reason",
                "chain_hash",
            ],
            extrasaction="ignore",
        )
        writer.writeheader()
        writer.writerows(rows)
        return Response(
            content=buffer.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=audit-export.csv"},
        )

    raise HTTPException(status_code=400, detail="format must be csv or json")


@router.get("/audit/{audit_id}", response_model=AuditEventOut)
def get_audit_event(
    audit_id: UUID,
    db: Session = Depends(get_db),
    _=Depends(require_roles("Admin", "Security", "Auditor")),
) -> AuditEvent:
    event = db.query(AuditEvent).filter(AuditEvent.id == audit_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Audit event not found")
    return event
