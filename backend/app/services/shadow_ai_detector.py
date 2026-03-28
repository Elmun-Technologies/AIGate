import hashlib
import re
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Any
from urllib.parse import urlparse

from sqlalchemy import and_, func
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.ai_billing_subscription import AIBillingSubscription
from app.models.ai_provider import AIProvider
from app.models.ai_spend_alert import AISpendAlert
from app.models.ai_usage_event import AIUsageEvent
from app.models.agent import Agent
from app.models.api_key import APIKey
from app.models.tool_call import ToolCall

HOST_PROVIDER_MAP = {
    "api.openai.com": "openai",
    "api.anthropic.com": "anthropic",
    "generativelanguage.googleapis.com": "gemini",
    "api.perplexity.ai": "perplexity",
}

MODEL_PRICING = {
    # price per 1K tokens (input, output)
    "gpt-4.1-mini": (Decimal("0.0004"), Decimal("0.0016")),
    "gpt-4.1": (Decimal("0.0020"), Decimal("0.0080")),
    "claude-3-5-sonnet": (Decimal("0.0030"), Decimal("0.0150")),
    "gemini-1.5-pro": (Decimal("0.0015"), Decimal("0.0050")),
}

DEFAULT_MODEL_PRICING = (Decimal("0.0010"), Decimal("0.0030"))

AUTH_BEARER_PATTERN = re.compile(r"bearer\s+([^\s]+)", re.IGNORECASE)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _organization_id_from_agent(agent: Agent | None) -> uuid.UUID:
    if not agent:
        return settings.AI_DEFAULT_ORGANIZATION_ID
    domain = "agent-gateway.local"
    if "@" in agent.owner_email:
        domain = agent.owner_email.split("@", 1)[1].strip().lower() or domain
    return uuid.uuid5(uuid.NAMESPACE_DNS, domain)


def _recursive_find_headers(value: Any) -> dict[str, str]:
    if isinstance(value, dict):
        lower_keys = {str(k).lower(): v for k, v in value.items()}
        if "authorization" in lower_keys or "x-api-key" in lower_keys:
            return {str(k): str(v) for k, v in value.items()}
        for nested in value.values():
            found = _recursive_find_headers(nested)
            if found:
                return found
    if isinstance(value, list):
        for item in value:
            found = _recursive_find_headers(item)
            if found:
                return found
    return {}


def _recursive_find_url(value: Any) -> str | None:
    if isinstance(value, str) and value.startswith(("http://", "https://")):
        return value
    if isinstance(value, dict):
        for nested in value.values():
            found = _recursive_find_url(nested)
            if found:
                return found
    if isinstance(value, list):
        for item in value:
            found = _recursive_find_url(item)
            if found:
                return found
    return None


def _detect_provider_from_payload(
    tool_name: str,
    args: dict[str, Any],
    headers: dict[str, str],
    fallback_provider: str | None,
) -> str:
    parsed_provider = fallback_provider.strip().lower() if isinstance(fallback_provider, str) and fallback_provider else None
    if parsed_provider:
        return parsed_provider

    url = _recursive_find_url(args)
    if url:
        host = (urlparse(url).hostname or "").lower()
        if host in HOST_PROVIDER_MAP:
            return HOST_PROVIDER_MAP[host]

    auth_value = ""
    for key, value in headers.items():
        if str(key).lower() == "authorization":
            auth_value = str(value).lower()
            break
    if "bearer sk-ant-" in auth_value:
        return "anthropic"
    if "bearer sk-" in auth_value:
        return "openai"
    if "bearer ai" in auth_value or "bearer ya29" in auth_value:
        return "gemini"

    if tool_name == "external_post":
        return "unknown"
    return "openai"


def _extract_api_key(headers: dict[str, str], fallback: str | None) -> str | None:
    for key, value in headers.items():
        key_lower = key.lower()
        value_str = str(value)
        if key_lower == "authorization":
            match = AUTH_BEARER_PATTERN.search(value_str)
            if match:
                return match.group(1)
        if key_lower in {"x-api-key", "api-key"} and value_str:
            return value_str
    return fallback


def _key_fingerprint(raw_key: str) -> str:
    return hashlib.sha256(raw_key.encode("utf-8")).hexdigest()


def _mask_key(raw_key: str) -> str:
    return raw_key[-6:] if len(raw_key) >= 6 else raw_key


def _estimate_tokens(text: Any) -> int:
    if text is None:
        return 0
    as_text = str(text)
    if not as_text:
        return 0
    return max(1, int(len(as_text) / 4))


def _estimate_cost(model: str | None, prompt_tokens: int, completion_tokens: int) -> Decimal:
    input_price_k, output_price_k = MODEL_PRICING.get((model or "").lower(), DEFAULT_MODEL_PRICING)
    in_cost = (Decimal(prompt_tokens) / Decimal(1000)) * input_price_k
    out_cost = (Decimal(completion_tokens) / Decimal(1000)) * output_price_k
    return (in_cost + out_cost).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)


def _ensure_provider(db: Session, provider_name: str, provider_type: str = "api") -> tuple[AIProvider, bool]:
    provider = db.query(AIProvider).filter(AIProvider.name == provider_name).first()
    if provider:
        return provider, False
    provider = AIProvider(name=provider_name, type=provider_type)
    db.add(provider)
    db.flush()
    return provider, True


def _create_alert(
    db: Session,
    *,
    organization_id: uuid.UUID,
    alert_type: str,
    message: str,
    severity: str,
    payload_json: dict[str, Any],
) -> AISpendAlert:
    day_start = _now().replace(hour=0, minute=0, second=0, microsecond=0)
    existing = (
        db.query(AISpendAlert)
        .filter(
            AISpendAlert.organization_id == organization_id,
            AISpendAlert.type == alert_type,
            AISpendAlert.created_at >= day_start,
            AISpendAlert.resolved_at.is_(None),
        )
        .first()
    )
    if existing:
        existing.message = message
        existing.severity = severity
        existing.payload_json = payload_json
        db.flush()
        return existing
    alert = AISpendAlert(
        organization_id=organization_id,
        type=alert_type,
        message=message,
        severity=severity,
        payload_json=payload_json,
    )
    db.add(alert)
    db.flush()
    return alert


def _ensure_api_key(
    db: Session,
    *,
    organization_id: uuid.UUID,
    provider_id: uuid.UUID,
    discovered_from: str,
    fingerprint_hash: str,
    masked_key: str,
    status: str,
) -> tuple[APIKey, bool]:
    api_key = (
        db.query(APIKey)
        .filter(
            APIKey.organization_id == organization_id,
            APIKey.provider_id == provider_id,
            APIKey.fingerprint_hash == fingerprint_hash,
        )
        .first()
    )
    now = _now()
    if api_key:
        api_key.last_seen_at = now
        if api_key.status == "revoked" and status == "active":
            api_key.status = "active"
        db.flush()
        return api_key, False

    api_key = APIKey(
        organization_id=organization_id,
        provider_id=provider_id,
        fingerprint_hash=fingerprint_hash,
        masked_key=masked_key,
        discovered_from=discovered_from,
        first_seen_at=now,
        last_seen_at=now,
        status=status,
    )
    db.add(api_key)
    db.flush()
    return api_key, True


def _risk_level_from_monthly_cost(value: Decimal) -> str:
    if value >= Decimal("1000"):
        return "high"
    if value >= Decimal("100"):
        return "medium"
    return "low"


def analyze_tool_call(
    db: Session,
    *,
    tool_call: ToolCall,
    agent: Agent | None,
    tool_name: str,
    args: dict[str, Any],
    prompt: str | None,
    response: Any,
    fallback_provider: str | None = None,
    source_hint: str = "proxy",
) -> AIUsageEvent:
    organization_id = _organization_id_from_agent(agent)
    headers = _recursive_find_headers(args or {})
    provider_name = _detect_provider_from_payload(
        tool_name=tool_name,
        args=args or {},
        headers=headers,
        fallback_provider=fallback_provider,
    )
    provider, provider_created = _ensure_provider(db, provider_name)
    raw_api_key = _extract_api_key(headers, fallback=agent.api_key_hash if agent else None)
    if raw_api_key:
        fingerprint_hash = _key_fingerprint(raw_api_key)
        masked_key = _mask_key(raw_api_key)
    else:
        fallback = f"agent:{agent.id}" if agent else f"tool_call:{tool_call.id}"
        fingerprint_hash = _key_fingerprint(fallback)
        masked_key = fallback[-6:]

    api_key_status = "active" if agent else "unknown"
    api_key, key_created = _ensure_api_key(
        db,
        organization_id=organization_id,
        provider_id=provider.id,
        discovered_from=source_hint,
        fingerprint_hash=fingerprint_hash,
        masked_key=masked_key,
        status=api_key_status,
    )

    endpoint = _recursive_find_url(args or {}) or tool_name
    prompt_tokens = tool_call.tokens_in if tool_call.tokens_in is not None else _estimate_tokens(prompt or "")
    completion_tokens = tool_call.tokens_out if tool_call.tokens_out is not None else _estimate_tokens(response)
    effective_model = tool_call.model or "unknown"
    estimated_cost = _estimate_cost(effective_model, prompt_tokens, completion_tokens)
    effective_cost = Decimal(tool_call.cost_usd) if tool_call.cost_usd is not None else estimated_cost
    user_identifier = agent.owner_email if agent else None
    ip_address = (args or {}).get("ip_address") if isinstance(args, dict) else None

    usage = db.query(AIUsageEvent).filter(AIUsageEvent.tool_call_id == tool_call.id).first()
    if not usage:
        usage = AIUsageEvent(tool_call_id=tool_call.id)
        db.add(usage)

    usage.api_key_id = api_key.id
    usage.provider_id = provider.id
    usage.organization_id = organization_id
    usage.agent_id = tool_call.agent_id
    usage.model = effective_model
    usage.endpoint = str(endpoint)
    usage.prompt_tokens = int(prompt_tokens or 0)
    usage.completion_tokens = int(completion_tokens or 0)
    usage.cost_usd = effective_cost.quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)
    usage.ip_address = str(ip_address) if ip_address else None
    usage.user_identifier = user_identifier
    usage.detected_source = "agent" if agent else "unknown"
    usage.source_hint = source_hint
    db.flush()

    if provider_created:
        _create_alert(
            db,
            organization_id=organization_id,
            alert_type="new_provider",
            message=f"New AI provider detected: {provider.name}",
            severity="medium",
            payload_json={"provider": provider.name, "organization_id": str(organization_id)},
        )

    if key_created:
        _create_alert(
            db,
            organization_id=organization_id,
            alert_type="anomaly",
            message=f"New API key fingerprint detected for provider {provider.name}",
            severity="high" if api_key.status == "unknown" else "medium",
            payload_json={
                "provider": provider.name,
                "masked_key": api_key.masked_key,
                "status": api_key.status,
                "event": "new_api_key",
                "organization_id": str(organization_id),
            },
        )

    if api_key.status == "unknown":
        _create_alert(
            db,
            organization_id=organization_id,
            alert_type="anomaly",
            message=f"Unknown API key usage detected for provider {provider.name}",
            severity="high",
            payload_json={
                "provider": provider.name,
                "masked_key": api_key.masked_key,
                "tool_call_id": str(tool_call.id),
                "event": "unknown_api_key",
            },
        )

    return usage


def ingest_external_usage_event(
    db: Session,
    *,
    provider_name: str,
    api_key_hash: str,
    model: str | None,
    cost_usd: Decimal,
    source_hint: str,
    tokens_in: int | None,
    tokens_out: int | None,
    user_identifier: str | None = None,
    endpoint: str | None = None,
) -> AIUsageEvent:
    organization_id = settings.AI_DEFAULT_ORGANIZATION_ID
    provider, provider_created = _ensure_provider(db, provider_name)
    fingerprint_hash = _key_fingerprint(api_key_hash)
    masked_key = _mask_key(api_key_hash)
    api_key, key_created = _ensure_api_key(
        db,
        organization_id=organization_id,
        provider_id=provider.id,
        discovered_from=source_hint,
        fingerprint_hash=fingerprint_hash,
        masked_key=masked_key,
        status="unknown",
    )

    usage = AIUsageEvent(
        api_key_id=api_key.id,
        provider_id=provider.id,
        organization_id=organization_id,
        agent_id=None,
        model=model or "unknown",
        endpoint=endpoint or "telemetry_ingest",
        prompt_tokens=int(tokens_in or 0),
        completion_tokens=int(tokens_out or 0),
        cost_usd=Decimal(cost_usd).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP),
        ip_address=None,
        user_identifier=user_identifier,
        detected_source="unknown",
        source_hint=source_hint,
    )
    db.add(usage)
    db.flush()

    if provider_created:
        _create_alert(
            db,
            organization_id=organization_id,
            alert_type="new_provider",
            message=f"New AI provider detected: {provider.name}",
            severity="medium",
            payload_json={"provider": provider.name, "organization_id": str(organization_id)},
        )
    if key_created:
        _create_alert(
            db,
            organization_id=organization_id,
            alert_type="anomaly",
            message=f"New API key fingerprint detected for provider {provider.name}",
            severity="high",
            payload_json={"provider": provider.name, "masked_key": api_key.masked_key, "event": "new_api_key"},
        )
    _create_alert(
        db,
        organization_id=organization_id,
        alert_type="anomaly",
        message=f"Unknown API key usage detected for provider {provider.name}",
        severity="high",
        payload_json={"provider": provider.name, "masked_key": api_key.masked_key, "event": "unknown_api_key"},
    )
    return usage


def _daily_spend(db: Session, organization_id: uuid.UUID, start: datetime, end: datetime) -> Decimal:
    total = (
        db.query(func.coalesce(func.sum(AIUsageEvent.cost_usd), 0))
        .filter(
            AIUsageEvent.organization_id == organization_id,
            AIUsageEvent.created_at >= start,
            AIUsageEvent.created_at < end,
        )
        .scalar()
    )
    return Decimal(total or 0)


def evaluate_ai_spend_alerts(db: Session) -> dict[str, Any]:
    now = _now()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    tomorrow_start = today_start + timedelta(days=1)
    yesterday_start = today_start - timedelta(days=1)
    baseline_start = today_start - timedelta(days=7)
    org_rows = db.query(AIUsageEvent.organization_id).distinct().all()
    triggered = 0

    for row in org_rows:
        organization_id = row.organization_id
        today_spend = _daily_spend(db, organization_id, today_start, tomorrow_start)
        if today_spend >= settings.SPEND_DAILY_THRESHOLD_USD:
            _create_alert(
                db,
                organization_id=organization_id,
                alert_type="threshold",
                message=f"Daily AI spend threshold exceeded: ${today_spend}",
                severity="high",
                payload_json={
                    "today_spend": float(today_spend),
                    "threshold_usd": float(settings.SPEND_DAILY_THRESHOLD_USD),
                },
            )
            triggered += 1

        baseline_sum = _daily_spend(db, organization_id, baseline_start, yesterday_start)
        baseline_avg = baseline_sum / Decimal("7")
        if baseline_avg > 0 and today_spend > baseline_avg * settings.AI_DAILY_SPIKE_MULTIPLIER:
            spike_ratio = (today_spend / baseline_avg).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            _create_alert(
                db,
                organization_id=organization_id,
                alert_type="anomaly",
                message=f"Daily AI spend spike detected: {spike_ratio}x above 7-day average",
                severity="high",
                payload_json={
                    "today_spend": float(today_spend),
                    "baseline_avg": float(baseline_avg),
                    "spike_ratio": float(spike_ratio),
                },
            )
            triggered += 1

    db.flush()
    return {"organizations": len(org_rows), "triggered": triggered}


def update_billing_subscriptions(db: Session) -> dict[str, Any]:
    now = _now()
    lookback_start = now - timedelta(days=30)
    rows = (
        db.query(
            AIUsageEvent.organization_id,
            AIUsageEvent.provider_id,
            func.coalesce(func.sum(AIUsageEvent.cost_usd), 0).label("total_cost"),
            func.count(func.distinct(func.date_trunc("day", AIUsageEvent.created_at))).label("days_seen"),
        )
        .filter(AIUsageEvent.created_at >= lookback_start)
        .group_by(AIUsageEvent.organization_id, AIUsageEvent.provider_id)
        .all()
    )
    updated = 0

    for row in rows:
        total_cost = Decimal(row.total_cost or 0)
        days_seen = int(row.days_seen or 0)
        if days_seen <= 0:
            continue
        estimated_monthly = (total_cost / Decimal(days_seen) * Decimal("30")).quantize(Decimal("0.000001"))
        if estimated_monthly < Decimal("1"):
            continue

        subscription = (
            db.query(AIBillingSubscription)
            .filter(
                AIBillingSubscription.organization_id == row.organization_id,
                AIBillingSubscription.provider_id == row.provider_id,
            )
            .first()
        )
        created_new = False
        if not subscription:
            subscription = AIBillingSubscription(
                organization_id=row.organization_id,
                provider_id=row.provider_id,
                detected_plan_name="usage-observed",
                estimated_monthly_cost=estimated_monthly,
                billing_cycle="usage",
                first_detected_at=now,
                last_seen_at=now,
                risk_level=_risk_level_from_monthly_cost(estimated_monthly),
            )
            db.add(subscription)
            db.flush()
            created_new = True
        else:
            subscription.detected_plan_name = "usage-observed"
            subscription.estimated_monthly_cost = estimated_monthly
            subscription.billing_cycle = "usage"
            subscription.last_seen_at = now
            subscription.risk_level = _risk_level_from_monthly_cost(estimated_monthly)
            db.flush()

        if created_new:
            _create_alert(
                db,
                organization_id=row.organization_id,
                alert_type="new_subscription",
                message="Potential new AI billing subscription detected",
                severity="medium" if subscription.risk_level != "high" else "high",
                payload_json={
                    "provider_id": str(row.provider_id),
                    "estimated_monthly_cost": float(estimated_monthly),
                    "billing_cycle": "usage",
                },
            )
        updated += 1

    db.flush()
    return {"updated": updated}


def run_governance_cycle(db: Session) -> dict[str, Any]:
    spend = evaluate_ai_spend_alerts(db)
    subscriptions = update_billing_subscriptions(db)
    db.commit()
    return {"status": "ok", "alerts": spend, "subscriptions": subscriptions}
