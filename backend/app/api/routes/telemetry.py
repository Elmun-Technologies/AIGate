from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from rq import Queue
from sqlalchemy.orm import Session

from app.api.deps import get_db, get_rq_queue, require_roles
from app.models.provider_usage_event import ProviderUsageEvent
from app.schemas.telemetry import ShadowAIEventOut, TelemetryIngestRequest, TelemetryIngestResponse
from app.services.alert_engine import create_unknown_key_alert
from app.services.telemetry import ingest_telemetry_event

AGGREGATE_SPEND_JOB = "app.worker_tasks.aggregate_spend_task"
EVALUATE_ALERTS_JOB = "app.worker_tasks.evaluate_alerts_task"

router = APIRouter(tags=["telemetry"])


@router.post("/telemetry/ingest", response_model=TelemetryIngestResponse)
def ingest_telemetry(
    payload: TelemetryIngestRequest,
    db: Session = Depends(get_db),
    queue: Queue = Depends(get_rq_queue),
    _=Depends(require_roles("Admin", "Security", "Auditor")),
) -> ProviderUsageEvent:
    usage = ingest_telemetry_event(
        db,
        provider=payload.provider,
        api_key_hash=payload.api_key_hash,
        model=payload.model,
        cost_usd=payload.cost_usd,
        source_hint=payload.source_hint,
        tokens_in=payload.tokens_in,
        tokens_out=payload.tokens_out,
    )
    if usage.shadow_ai_usage:
        create_unknown_key_alert(
            db,
            api_key_fingerprint=usage.api_key_fingerprint or "unknown",
            provider=usage.provider,
            cost_usd=Decimal(usage.cost_usd),
        )

    db.commit()
    db.refresh(usage)
    queue.enqueue(AGGREGATE_SPEND_JOB)
    queue.enqueue(EVALUATE_ALERTS_JOB)
    return usage


@router.get("/shadow-ai/events", response_model=list[ShadowAIEventOut])
def list_shadow_ai_events(
    from_: datetime | None = Query(default=None, alias="from"),
    to: datetime | None = None,
    provider: str | None = None,
    db: Session = Depends(get_db),
    _=Depends(require_roles("Admin", "Security", "Auditor")),
) -> list[ProviderUsageEvent]:
    end = to or datetime.now(timezone.utc)
    start = from_ or (end.replace(hour=0, minute=0, second=0, microsecond=0))

    query = db.query(ProviderUsageEvent).filter(
        ProviderUsageEvent.shadow_ai_usage.is_(True),
        ProviderUsageEvent.timestamp >= start,
        ProviderUsageEvent.timestamp <= end,
    )
    if provider:
        query = query.filter(ProviderUsageEvent.provider == provider.strip().lower())
    return query.order_by(ProviderUsageEvent.timestamp.desc()).limit(500).all()
