import hashlib
from datetime import date, datetime, time, timezone

from sqlalchemy.orm import Session

from app.models.audit_anchor import AuditAnchor
from app.models.audit_event import AuditEvent
from app.services.anchor_client import submit_anchor


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _leaf_hashes(events: list[AuditEvent]) -> list[str]:
    leaves: list[str] = []
    for event in events:
        leaf_input = f"{event.id}|{event.stream_id}|{event.chain_hash}|{event.prev_hash or ''}|{event.created_at.isoformat() if event.created_at else ''}"
        leaves.append(_sha256(leaf_input))
    return leaves


def _merkle_root(leaves: list[str]) -> str:
    if not leaves:
        return _sha256("empty")
    current = [leaf if len(leaf) == 64 else _sha256(leaf) for leaf in leaves]
    while len(current) > 1:
        next_level: list[str] = []
        for i in range(0, len(current), 2):
            left = current[i]
            right = current[i + 1] if i + 1 < len(current) else left
            next_level.append(_sha256(left + right))
        current = next_level
    return current[0]


def _window(day: date) -> tuple[datetime, datetime]:
    start = datetime.combine(day, time.min).replace(tzinfo=timezone.utc)
    end = datetime.combine(day, time.max).replace(tzinfo=timezone.utc)
    return start, end


def _compute_day_materials(db: Session, *, day: date) -> dict:
    start, end = _window(day)
    rows = (
        db.query(AuditEvent)
        .filter(AuditEvent.created_at >= start, AuditEvent.created_at <= end)
        .order_by(AuditEvent.created_at.asc(), AuditEvent.id.asc())
        .all()
    )
    leaves = _leaf_hashes(rows)
    return {
        "rows": rows,
        "leaves": leaves,
        "merkle_root": _merkle_root(leaves),
        "chain_head": rows[0].chain_hash if rows else "none",
        "chain_tail": rows[-1].chain_hash if rows else "none",
    }


def anchor_audit_day(db: Session, *, day: date, backend: str = "local_notary") -> AuditAnchor:
    materials = _compute_day_materials(db, day=day)
    _, anchor_ref = submit_anchor(
        anchor_date=day.isoformat(),
        merkle_root=materials["merkle_root"],
        leaf_count=len(materials["leaves"]),
    )
    final_backend = backend
    anchor = (
        db.query(AuditAnchor)
        .filter(AuditAnchor.anchor_date == day, AuditAnchor.anchor_backend == final_backend)
        .first()
    )
    if not anchor:
        anchor = AuditAnchor(
            anchor_date=day,
            merkle_root=materials["merkle_root"],
            leaf_count=len(materials["leaves"]),
            chain_head=materials["chain_head"],
            chain_tail=materials["chain_tail"],
            anchor_backend=final_backend,
            anchor_ref=anchor_ref,
        )
        db.add(anchor)
    else:
        anchor.merkle_root = materials["merkle_root"]
        anchor.leaf_count = len(materials["leaves"])
        anchor.chain_head = materials["chain_head"]
        anchor.chain_tail = materials["chain_tail"]
        anchor.anchor_ref = anchor_ref
    db.flush()
    return anchor


def verify_anchor_day(db: Session, *, day: date, backend: str = "local_notary") -> dict:
    anchor = (
        db.query(AuditAnchor)
        .filter(AuditAnchor.anchor_date == day, AuditAnchor.anchor_backend == backend)
        .first()
    )
    if not anchor:
        return {"ok": False, "reason": "anchor_not_found", "anchor_date": day.isoformat(), "anchor_backend": backend}
    materials = _compute_day_materials(db, day=day)
    valid = bool(
        materials["merkle_root"] == anchor.merkle_root
        and len(materials["leaves"]) == anchor.leaf_count
    )
    return {
        "ok": valid,
        "anchor_date": day.isoformat(),
        "anchor_backend": backend,
        "stored_merkle_root": anchor.merkle_root,
        "recomputed_merkle_root": materials["merkle_root"],
        "leaf_count": int(anchor.leaf_count),
        "anchor_ref": anchor.anchor_ref,
        "reason": "ok" if valid else "mismatch",
    }
