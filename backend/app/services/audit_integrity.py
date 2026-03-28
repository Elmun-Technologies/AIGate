import hashlib
import json
from collections import defaultdict

from sqlalchemy import and_
from sqlalchemy.orm import Session, aliased

from app.models.audit_event import AuditEvent


def canonical_json(data: dict) -> str:
    return json.dumps(data or {}, sort_keys=True, separators=(",", ":"), ensure_ascii=True, default=str)


def compute_chain_hash(prev_hash: str, payload: dict) -> str:
    return hashlib.sha256(f"{prev_hash}{canonical_json(payload)}".encode("utf-8")).hexdigest()


def get_stream_tail_event(db: Session, stream_id: str) -> AuditEvent | None:
    next_event = aliased(AuditEvent)
    tail = (
        db.query(AuditEvent)
        .outerjoin(
            next_event,
            and_(
                next_event.stream_id == AuditEvent.stream_id,
                next_event.prev_hash == AuditEvent.chain_hash,
            ),
        )
        .filter(AuditEvent.stream_id == stream_id)
        .filter(next_event.id.is_(None))
        .order_by(AuditEvent.created_at.desc(), AuditEvent.id.desc())
        .first()
    )
    if tail:
        return tail
    return (
        db.query(AuditEvent)
        .filter(AuditEvent.stream_id == stream_id)
        .order_by(AuditEvent.created_at.desc(), AuditEvent.id.desc())
        .first()
    )


def _sort_key(event: AuditEvent) -> tuple[str, str]:
    created = event.created_at.isoformat() if event.created_at else ""
    return created, str(event.id)


def verify_stream_chain(stream_events: list[AuditEvent]) -> list[dict]:
    if not stream_events:
        return []

    issues: list[dict] = []
    stream_id = stream_events[0].stream_id
    by_prev: dict[str, list[AuditEvent]] = defaultdict(list)
    by_hash: dict[str, list[AuditEvent]] = defaultdict(list)

    for event in stream_events:
        by_prev[event.prev_hash or ""].append(event)
        by_hash[event.chain_hash].append(event)

    for events in by_prev.values():
        events.sort(key=_sort_key)

    roots = by_prev.get("", [])
    if len(roots) != 1:
        issues.append(
            {
                "stream_id": stream_id,
                "event_id": None,
                "created_at": None,
                "reason": "invalid_root_count",
                "detail": f"expected 1 root, found {len(roots)}",
            }
        )

    visited: set[str] = set()
    cursor = roots[0] if roots else sorted(stream_events, key=_sort_key)[0]

    while cursor:
        event_id = str(cursor.id)
        if event_id in visited:
            issues.append(
                {
                    "stream_id": cursor.stream_id,
                    "event_id": event_id,
                    "created_at": cursor.created_at.isoformat() if cursor.created_at else None,
                    "reason": "cycle_detected",
                }
            )
            break

        visited.add(event_id)
        prev_hash = cursor.prev_hash or ""
        expected_hash = compute_chain_hash(prev_hash, cursor.payload_redacted_json or {})
        if cursor.chain_hash != expected_hash:
            issues.append(
                {
                    "stream_id": cursor.stream_id,
                    "event_id": event_id,
                    "created_at": cursor.created_at.isoformat() if cursor.created_at else None,
                    "reason": "chain_hash_mismatch",
                }
            )

        children = by_prev.get(cursor.chain_hash, [])
        if len(children) > 1:
            issues.append(
                {
                    "stream_id": cursor.stream_id,
                    "event_id": event_id,
                    "created_at": cursor.created_at.isoformat() if cursor.created_at else None,
                    "reason": "fork_detected",
                    "detail": f"children={len(children)}",
                }
            )
        cursor = children[0] if children else None

    for event in stream_events:
        event_id = str(event.id)
        if event_id not in visited:
            issues.append(
                {
                    "stream_id": event.stream_id,
                    "event_id": event_id,
                    "created_at": event.created_at.isoformat() if event.created_at else None,
                    "reason": "orphan_event",
                }
            )
        prev_hash = event.prev_hash or ""
        if prev_hash and prev_hash not in by_hash:
            issues.append(
                {
                    "stream_id": event.stream_id,
                    "event_id": event_id,
                    "created_at": event.created_at.isoformat() if event.created_at else None,
                    "reason": "dangling_prev_hash",
                }
            )

    return issues


def verify_audit_rows(rows: list[AuditEvent]) -> dict:
    streams: dict[str, list[AuditEvent]] = defaultdict(list)
    for row in rows:
        streams[row.stream_id].append(row)

    issues: list[dict] = []
    for stream_id in sorted(streams.keys()):
        stream_issues = verify_stream_chain(streams[stream_id])
        issues.extend(stream_issues)

    return {
        "valid": len(issues) == 0,
        "checked_streams": len(streams),
        "checked_events": len(rows),
        "issues_count": len(issues),
        "issues": issues[:100],
    }
