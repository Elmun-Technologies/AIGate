from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import case, desc, func
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db, require_roles
from app.models.ai_billing_subscription import AIBillingSubscription
from app.models.ai_provider import AIProvider
from app.models.ai_spend_alert import AISpendAlert
from app.models.ai_usage_event import AIUsageEvent
from app.models.api_key import APIKey
from app.models.user import User
from app.schemas.ai_governance import ResolveAISpendAlertRequest
from app.services.audit_chain import append_audit_event
from app.services.redaction import redact_data
from app.services.shadow_ai_detector import run_governance_cycle

router = APIRouter(prefix="/ai-governance", tags=["ai-governance"])


def _to_float(value: Decimal | None) -> float:
    return float(value or 0)


def _window_start(days: int) -> datetime:
    now = datetime.now(timezone.utc)
    return now - timedelta(days=max(1, days))


@router.get("/summary")
def get_summary(
    days: int = Query(default=7, ge=1, le=365),
    db: Session = Depends(get_db),
    _=Depends(require_roles("Admin", "Security", "Auditor")),
) -> dict:
    run_governance_cycle(db)
    start = _window_start(days)
    now = datetime.now(timezone.utc)

    total_usd_decimal = (
        db.query(func.coalesce(func.sum(AIUsageEvent.cost_usd), 0))
        .filter(AIUsageEvent.created_at >= start)
        .scalar()
    ) or Decimal("0")

    projected_monthly_decimal = (Decimal(total_usd_decimal) / Decimal(max(1, days))) * Decimal(30)

    shadow_providers_count = (
        db.query(func.count(func.distinct(APIKey.provider_id)))
        .filter(APIKey.status == "unknown")
        .scalar()
    ) or 0

    open_alerts_count = (
        db.query(func.count(AISpendAlert.id))
        .filter(AISpendAlert.resolved_at.is_(None))
        .scalar()
    ) or 0

    by_day_rows = (
        db.query(
            func.date_trunc("day", AIUsageEvent.created_at).label("day"),
            func.coalesce(func.sum(AIUsageEvent.cost_usd), 0).label("usd"),
        )
        .filter(AIUsageEvent.created_at >= start)
        .group_by(func.date_trunc("day", AIUsageEvent.created_at))
        .order_by(func.date_trunc("day", AIUsageEvent.created_at).asc())
        .all()
    )

    daily_map = {row.day.date().isoformat(): _to_float(row.usd) for row in by_day_rows}
    spend_by_day: list[dict] = []
    cursor = start.date()
    end_date = now.date()
    while cursor <= end_date:
        day_str = cursor.isoformat()
        spend_by_day.append({"day": day_str, "usd": daily_map.get(day_str, 0.0)})
        cursor += timedelta(days=1)

    severity_rank = case(
        (AISpendAlert.severity == "critical", 4),
        (AISpendAlert.severity == "high", 3),
        (AISpendAlert.severity == "medium", 2),
        (AISpendAlert.severity == "low", 1),
        else_=0,
    )
    top_alert_rows = (
        db.query(AISpendAlert)
        .filter(AISpendAlert.resolved_at.is_(None))
        .order_by(severity_rank.desc(), AISpendAlert.created_at.desc())
        .limit(10)
        .all()
    )

    top_user_rows = (
        db.query(
            AIUsageEvent.user_identifier.label("user_identifier"),
            AIProvider.name.label("provider"),
            AIUsageEvent.model.label("model"),
            func.coalesce(func.sum(AIUsageEvent.cost_usd), 0).label("cost_usd"),
            func.count(AIUsageEvent.id).label("events"),
        )
        .join(AIProvider, AIProvider.id == AIUsageEvent.provider_id)
        .filter(AIUsageEvent.created_at >= start)
        .group_by(AIUsageEvent.user_identifier, AIProvider.name, AIUsageEvent.model)
        .order_by(desc("cost_usd"))
        .limit(10)
        .all()
    )

    usage_subquery = (
        db.query(
            AIUsageEvent.provider_id.label("provider_id"),
            func.coalesce(func.sum(AIUsageEvent.cost_usd), 0).label("usd"),
        )
        .filter(AIUsageEvent.created_at >= start)
        .group_by(AIUsageEvent.provider_id)
        .subquery()
    )
    keys_subquery = (
        db.query(
            APIKey.provider_id.label("provider_id"),
            func.count(APIKey.id).label("keys_count"),
        )
        .filter(APIKey.status != "revoked")
        .group_by(APIKey.provider_id)
        .subquery()
    )
    subscriptions_subquery = (
        db.query(
            AIBillingSubscription.provider_id.label("provider_id"),
            func.count(AIBillingSubscription.id).label("subscriptions_count"),
        )
        .group_by(AIBillingSubscription.provider_id)
        .subquery()
    )

    top_provider_rows = (
        db.query(
            AIProvider.name.label("provider"),
            func.coalesce(usage_subquery.c.usd, 0).label("cost_usd"),
            func.coalesce(keys_subquery.c.keys_count, 0).label("keys_count"),
            func.coalesce(subscriptions_subquery.c.subscriptions_count, 0).label("subscriptions_count"),
        )
        .outerjoin(usage_subquery, usage_subquery.c.provider_id == AIProvider.id)
        .outerjoin(keys_subquery, keys_subquery.c.provider_id == AIProvider.id)
        .outerjoin(subscriptions_subquery, subscriptions_subquery.c.provider_id == AIProvider.id)
        .order_by(desc("cost_usd"), AIProvider.name.asc())
        .limit(10)
        .all()
    )

    return {
        "kpis": {
            "total_spend_7d_usd": _to_float(total_usd_decimal),
            "projected_monthly_usd": _to_float(projected_monthly_decimal),
            "shadow_providers_count": int(shadow_providers_count),
            "open_alerts_count": int(open_alerts_count),
        },
        "spend_by_day": spend_by_day,
        "top_alerts": [
            {
                "id": str(alert.id),
                "severity": alert.severity,
                "type": alert.type,
                "message": alert.message,
                "owner": (alert.payload_json or {}).get("resolution_owner"),
                "status": (alert.payload_json or {}).get("resolution_status") or ("resolved" if alert.resolved_at else "open"),
                "created_at": alert.created_at.isoformat() if alert.created_at else None,
            }
            for alert in top_alert_rows
        ],
        "top_users": [
            {
                "user_identifier": row.user_identifier or "unknown",
                "provider": row.provider,
                "model": row.model or "unknown",
                "cost_usd": _to_float(row.cost_usd),
                "events": int(row.events or 0),
            }
            for row in top_user_rows
        ],
        "top_providers": [
            {
                "provider": row.provider,
                "cost_usd": _to_float(row.cost_usd),
                "keys_count": int(row.keys_count or 0),
                "subscriptions_count": int(row.subscriptions_count or 0),
            }
            for row in top_provider_rows
        ],
    }


@router.get("/providers")
def get_providers(
    days: int = Query(default=7, ge=1, le=365),
    db: Session = Depends(get_db),
    _=Depends(require_roles("Admin", "Security", "Auditor")),
) -> dict:
    start = _window_start(days)
    rows = (
        db.query(
            AIProvider.name.label("provider"),
            AIProvider.type.label("provider_type"),
            func.coalesce(func.sum(AIUsageEvent.cost_usd), 0).label("total_usd"),
            func.count(AIUsageEvent.id).label("events"),
            func.count(func.distinct(AIUsageEvent.api_key_id)).label("unique_keys"),
            func.count(func.distinct(AIUsageEvent.user_identifier)).label("unique_users"),
        )
        .join(AIUsageEvent, AIUsageEvent.provider_id == AIProvider.id)
        .filter(AIUsageEvent.created_at >= start)
        .group_by(AIProvider.name, AIProvider.type)
        .order_by(desc("total_usd"))
        .all()
    )
    return {
        "days": days,
        "providers": [
            {
                "provider": row.provider,
                "provider_type": row.provider_type,
                "total_usd": _to_float(row.total_usd),
                "events": int(row.events or 0),
                "unique_keys": int(row.unique_keys or 0),
                "unique_users": int(row.unique_users or 0),
            }
            for row in rows
        ],
    }


@router.get("/keys")
def get_keys(
    status: str | None = None,
    db: Session = Depends(get_db),
    _=Depends(require_roles("Admin", "Security", "Auditor")),
) -> dict:
    query = (
        db.query(
            APIKey.id,
            APIKey.organization_id,
            AIProvider.name.label("provider"),
            APIKey.masked_key,
            APIKey.discovered_from,
            APIKey.first_seen_at,
            APIKey.last_seen_at,
            APIKey.status,
            func.coalesce(func.sum(AIUsageEvent.cost_usd), 0).label("total_usd"),
            func.count(AIUsageEvent.id).label("events"),
        )
        .join(AIProvider, AIProvider.id == APIKey.provider_id)
        .outerjoin(AIUsageEvent, AIUsageEvent.api_key_id == APIKey.id)
        .group_by(
            APIKey.id,
            APIKey.organization_id,
            AIProvider.name,
            APIKey.masked_key,
            APIKey.discovered_from,
            APIKey.first_seen_at,
            APIKey.last_seen_at,
            APIKey.status,
        )
        .order_by(APIKey.last_seen_at.desc())
    )
    if status:
        query = query.filter(APIKey.status == status)
    rows = query.limit(500).all()
    return {
        "keys": [
            {
                "id": str(row.id),
                "organization_id": str(row.organization_id),
                "provider": row.provider,
                "masked_key": row.masked_key,
                "discovered_from": row.discovered_from,
                "first_seen_at": row.first_seen_at.isoformat() if row.first_seen_at else None,
                "last_seen_at": row.last_seen_at.isoformat() if row.last_seen_at else None,
                "status": row.status,
                "total_usd": _to_float(row.total_usd),
                "events": int(row.events or 0),
            }
            for row in rows
        ]
    }


@router.get("/usage")
def get_usage(
    days: int = Query(default=7, ge=1, le=365),
    db: Session = Depends(get_db),
    _=Depends(require_roles("Admin", "Security", "Auditor")),
) -> dict:
    run_governance_cycle(db)
    start = _window_start(days)

    total_usd = db.query(func.coalesce(func.sum(AIUsageEvent.cost_usd), 0)).filter(AIUsageEvent.created_at >= start).scalar()

    by_day = (
        db.query(
            func.date_trunc("day", AIUsageEvent.created_at).label("day"),
            func.coalesce(func.sum(AIUsageEvent.cost_usd), 0).label("usd"),
        )
        .filter(AIUsageEvent.created_at >= start)
        .group_by(func.date_trunc("day", AIUsageEvent.created_at))
        .order_by(func.date_trunc("day", AIUsageEvent.created_at).asc())
        .all()
    )

    by_provider = (
        db.query(
            AIProvider.name.label("provider"),
            func.coalesce(func.sum(AIUsageEvent.cost_usd), 0).label("usd"),
            func.count(AIUsageEvent.id).label("events"),
        )
        .join(AIProvider, AIProvider.id == AIUsageEvent.provider_id)
        .filter(AIUsageEvent.created_at >= start)
        .group_by(AIProvider.name)
        .order_by(desc("usd"))
        .all()
    )

    by_user = (
        db.query(
            AIUsageEvent.user_identifier.label("user"),
            func.coalesce(func.sum(AIUsageEvent.cost_usd), 0).label("usd"),
            func.count(AIUsageEvent.id).label("events"),
        )
        .filter(AIUsageEvent.created_at >= start)
        .group_by(AIUsageEvent.user_identifier)
        .order_by(desc("usd"))
        .limit(100)
        .all()
    )

    by_model = (
        db.query(
            AIUsageEvent.model.label("model"),
            func.coalesce(func.sum(AIUsageEvent.cost_usd), 0).label("usd"),
            func.count(AIUsageEvent.id).label("events"),
        )
        .filter(AIUsageEvent.created_at >= start)
        .group_by(AIUsageEvent.model)
        .order_by(desc("usd"))
        .all()
    )

    return {
        "days": days,
        "total_usd": _to_float(total_usd),
        "by_day": [{"day": row.day.date().isoformat(), "usd": _to_float(row.usd)} for row in by_day],
        "by_provider": [{"provider": row.provider, "usd": _to_float(row.usd), "events": int(row.events or 0)} for row in by_provider],
        "by_user": [{"user": row.user or "unknown", "usd": _to_float(row.usd), "events": int(row.events or 0)} for row in by_user],
        "by_model": [{"model": row.model or "unknown", "usd": _to_float(row.usd), "events": int(row.events or 0)} for row in by_model],
    }


@router.get("/subscriptions")
def get_subscriptions(
    db: Session = Depends(get_db),
    _=Depends(require_roles("Admin", "Security", "Auditor")),
) -> dict:
    rows = (
        db.query(AIBillingSubscription, AIProvider.name.label("provider_name"))
        .join(AIProvider, AIProvider.id == AIBillingSubscription.provider_id)
        .order_by(AIBillingSubscription.last_seen_at.desc())
        .limit(500)
        .all()
    )
    return {
        "subscriptions": [
            {
                "id": str(sub.id),
                "organization_id": str(sub.organization_id),
                "provider_id": str(sub.provider_id),
                "provider_name": provider_name,
                "detected_plan_name": sub.detected_plan_name,
                "estimated_monthly_cost": _to_float(sub.estimated_monthly_cost),
                "billing_cycle": sub.billing_cycle,
                "first_detected_at": sub.first_detected_at.isoformat() if sub.first_detected_at else None,
                "last_seen_at": sub.last_seen_at.isoformat() if sub.last_seen_at else None,
                "risk_level": sub.risk_level,
            }
            for sub, provider_name in rows
        ]
    }


@router.get("/alerts")
def get_alerts(
    include_resolved: bool = False,
    days: int = Query(default=30, ge=1, le=365),
    db: Session = Depends(get_db),
    _=Depends(require_roles("Admin", "Security", "Auditor")),
) -> dict:
    start = _window_start(days)
    query = db.query(AISpendAlert).filter(AISpendAlert.created_at >= start)
    if not include_resolved:
        query = query.filter(AISpendAlert.resolved_at.is_(None))
    rows = query.order_by(AISpendAlert.created_at.desc()).limit(500).all()
    return {
        "alerts": [
            {
                "id": str(row.id),
                "organization_id": str(row.organization_id),
                "type": row.type,
                "message": row.message,
                "severity": row.severity,
                "payload_json": row.payload_json,
                "owner": (row.payload_json or {}).get("resolution_owner"),
                "status": (row.payload_json or {}).get("resolution_status") or ("resolved" if row.resolved_at else "open"),
                "created_at": row.created_at.isoformat() if row.created_at else None,
                "resolved_at": row.resolved_at.isoformat() if row.resolved_at else None,
            }
            for row in rows
        ]
    }


@router.post("/alerts/{alert_id}/resolve")
def resolve_alert(
    alert_id: UUID,
    payload: ResolveAISpendAlertRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _=Depends(require_roles("Admin", "Security", "Security_Approver")),
) -> dict:
    alert = db.query(AISpendAlert).filter(AISpendAlert.id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    if alert.resolved_at is None:
        alert.resolved_at = datetime.now(timezone.utc)
    payload_json = dict(alert.payload_json or {})
    payload_json.update(
        {
            "resolution_reason": payload.reason,
            "resolution_owner": payload.owner or user.email,
            "resolution_status": payload.status,
            "resolved_by": user.email,
            "resolved_at": alert.resolved_at.isoformat() if alert.resolved_at else None,
            "webhook_stub": {
                "target": "jira_or_slack_webhook",
                "delivered": False,
            },
        }
    )
    alert.payload_json = payload_json

    append_audit_event(
        db=db,
        stream_id=f"org:{alert.organization_id}",
        event_type="REMEDIATION_ACTION",
        payload_redacted_json=redact_data(
            {
                "alert_id": str(alert.id),
                "alert_type": alert.type,
                "severity": alert.severity,
                "resolution_reason": payload.reason,
                "resolution_owner": payload.owner or user.email,
                "resolution_status": payload.status,
                "resolved_by": user.email,
            }
        ),
        decision="ALLOW",
        risk_score=0,
    )
    db.commit()
    return {
        "id": str(alert.id),
        "owner": payload.owner or user.email,
        "status": payload.status,
        "reason": payload.reason,
        "resolved_at": alert.resolved_at.isoformat() if alert.resolved_at else None,
    }
