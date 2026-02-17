from datetime import datetime, timezone
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.agent import Agent
from app.models.provider_usage_event import ProviderUsageEvent
from app.models.tool_call import ToolCall


def normalize_detected_source(source_hint: str, has_registered_agent: bool) -> str:
    if has_registered_agent:
        return "agent"
    hint = source_hint.strip().lower()
    if hint == "browser":
        return "user"
    if hint in {"backend", "integration"}:
        return "service"
    return "unknown"


def upsert_tool_call_usage_event(
    db: Session,
    tool_call: ToolCall,
    api_key_fingerprint: str | None,
    source_hint: str = "backend",
) -> ProviderUsageEvent:
    usage = db.query(ProviderUsageEvent).filter(ProviderUsageEvent.tool_call_id == tool_call.id).first()
    if not usage:
        usage = ProviderUsageEvent(tool_call_id=tool_call.id)
        db.add(usage)

    usage.agent_id = tool_call.agent_id
    usage.provider = tool_call.provider or "openai"
    usage.model = tool_call.model
    usage.api_key_fingerprint = api_key_fingerprint
    usage.detected_source = "agent"
    usage.source_hint = source_hint
    usage.cost_usd = tool_call.cost_usd or Decimal("0")
    usage.tokens_in = tool_call.tokens_in
    usage.tokens_out = tool_call.tokens_out
    usage.shadow_ai_usage = False
    usage.timestamp = tool_call.created_at or datetime.now(timezone.utc)
    db.flush()
    return usage


def ingest_telemetry_event(
    db: Session,
    *,
    provider: str,
    api_key_hash: str,
    model: str | None,
    cost_usd: Decimal,
    source_hint: str,
    tokens_in: int | None,
    tokens_out: int | None,
) -> ProviderUsageEvent:
    registered_agent = db.query(Agent).filter(Agent.api_key_hash == api_key_hash).first()
    detected_source = normalize_detected_source(source_hint=source_hint, has_registered_agent=bool(registered_agent))
    usage = ProviderUsageEvent(
        agent_id=registered_agent.id if registered_agent else None,
        provider=provider,
        api_key_fingerprint=api_key_hash,
        model=model,
        detected_source=detected_source,
        source_hint=source_hint,
        cost_usd=cost_usd,
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        shadow_ai_usage=registered_agent is None,
    )
    db.add(usage)
    db.flush()
    return usage


def resolve_agent_api_fingerprint(db: Session, agent_id: UUID) -> str | None:
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        return None
    return agent.api_key_hash
