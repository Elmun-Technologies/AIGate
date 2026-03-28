from sqlalchemy.orm import Session

from app.models.audit_event import AuditEvent
from app.services.audit_integrity import compute_chain_hash, get_stream_tail_event


def append_audit_event(
    db: Session,
    stream_id: str,
    event_type: str,
    payload_redacted_json: dict,
    decision: str,
    risk_score: int,
) -> AuditEvent:
    previous = get_stream_tail_event(db=db, stream_id=stream_id)
    prev_hash = previous.chain_hash if previous else ""
    chain_hash = compute_chain_hash(prev_hash, payload_redacted_json)

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
