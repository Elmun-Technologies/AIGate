from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from rq import Queue
from sqlalchemy.orm import Session

from app.api.deps import get_db, get_rq_queue, require_roles
from app.models.ai_provider import AIProvider
from app.models.ai_usage_event import AIUsageEvent
from app.models.api_key import APIKey
from app.schemas.telemetry import ShadowAIEventOut, TelemetryIngestRequest, TelemetryIngestResponse
from app.services.shadow_ai_detector import ingest_external_usage_event

GOVERNANCE_CYCLE_JOB = "app.worker_tasks.run_ai_governance_cycle_task"

router = APIRouter(tags=["telemetry"])


@router.post("/telemetry/ingest", response_model=TelemetryIngestResponse)
def ingest_telemetry(
    payload: TelemetryIngestRequest,
    db: Session = Depends(get_db),
    queue: Queue = Depends(get_rq_queue),
    _=Depends(require_roles("Admin", "Security", "Auditor")),
) -> dict:
    usage = ingest_external_usage_event(
        db,
        provider_name=payload.provider,
        api_key_hash=payload.api_key_hash,
        model=payload.model,
        cost_usd=payload.cost_usd,
        source_hint=payload.source_hint,
        tokens_in=payload.tokens_in,
        tokens_out=payload.tokens_out,
    )
    api_key = db.query(APIKey).filter(APIKey.id == usage.api_key_id).first()
    db.commit()
    db.refresh(usage)
    queue.enqueue(GOVERNANCE_CYCLE_JOB)
    return {
        "id": usage.id,
        "shadow_ai_usage": bool(api_key and api_key.status == "unknown"),
        "detected_source": usage.detected_source,
        "provider": payload.provider,
        "timestamp": usage.created_at,
    }


@router.get("/shadow-ai/events", response_model=list[ShadowAIEventOut])
def list_shadow_ai_events(
    from_: datetime | None = Query(default=None, alias="from"),
    to: datetime | None = None,
    provider: str | None = None,
    db: Session = Depends(get_db),
    _=Depends(require_roles("Admin", "Security", "Auditor")),
) -> list[dict]:
    end = to or datetime.now(timezone.utc)
    start = from_ or (end.replace(hour=0, minute=0, second=0, microsecond=0))

    query = (
        db.query(AIUsageEvent, APIKey.masked_key, AIProvider.name.label("provider_name"))
        .join(APIKey, APIKey.id == AIUsageEvent.api_key_id)
        .join(AIProvider, AIProvider.id == AIUsageEvent.provider_id)
        .filter(
            APIKey.status == "unknown",
            AIUsageEvent.created_at >= start,
            AIUsageEvent.created_at <= end,
        )
    )
    if provider:
        query = query.filter(AIProvider.name == provider.strip().lower())
    rows = query.order_by(AIUsageEvent.created_at.desc()).limit(500).all()
    return [
        {
            "id": usage.id,
            "provider": provider_name,
            "masked_key": masked_key,
            "model": usage.model,
            "detected_source": usage.detected_source,
            "source_hint": usage.source_hint,
            "cost_usd": usage.cost_usd,
            "tokens_in": usage.prompt_tokens,
            "tokens_out": usage.completion_tokens,
            "user_identifier": usage.user_identifier,
            "created_at": usage.created_at,
        }
        for usage, masked_key, provider_name in rows
    ]
