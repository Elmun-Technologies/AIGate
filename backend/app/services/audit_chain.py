import hashlib
import json

from sqlalchemy.orm import Session

from app.models.audit_event import AuditEvent


def _canonical_json(data: dict) -> str:
    return json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=True, default=str)


def append_audit_event(
    db: Session,
    stream_id: str,
    event_type: str,
    payload_redacted_json: dict,
    decision: str,
    risk_score: int,
) -> AuditEvent:
    previous = (
        db.query(AuditEvent)
        .filter(AuditEvent.stream_id == stream_id)
        .order_by(AuditEvent.created_at.desc(), AuditEvent.id.desc())
        .first()
    )
    prev_hash = previous.chain_hash if previous else ""
    canonical_payload = _canonical_json(payload_redacted_json)
    chain_hash = hashlib.sha256(f"{prev_hash}{canonical_payload}".encode("utf-8")).hexdigest()

    event = AuditEvent(
        stream_id=stream_id,
        event_type=event_type,
        payload_redacted_json=payload_redacted_json,
        decision=decision,
        risk_score=risk_score,
        prev_hash=prev_hash or None,
        chain_hash=chain_hash,
    )
    db.add(event)
    db.flush()
    return event
