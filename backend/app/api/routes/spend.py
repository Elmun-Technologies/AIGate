from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, desc, func
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_roles
from app.models.agent import Agent
from app.models.alert import Alert
from app.models.provider_usage_event import ProviderUsageEvent
from app.models.spend_aggregate import SpendAggregate
from app.models.spend_alert import SpendAlert
from app.models.spend_anomaly import SpendAnomaly
from app.models.tool import Tool
from app.models.tool_call import ToolCall
from app.schemas.spend import SpendAlertCreate, SpendAlertOut
from app.services.alert_engine import evaluate_alert_rules
from app.services.spend_aggregation import aggregate_spend_data

router = APIRouter(prefix="/spend", tags=["spend"])


def _to_float(value: Decimal | None) -> float:
    if value is None:
        return 0.0
    return float(value)


def _resolve_window(from_: datetime | None, to: datetime | None) -> tuple[datetime, datetime]:
    now = datetime.now(timezone.utc)
    end = to or now
    start = from_ or (end - timedelta(days=7))
    return start, end


def _period_start(period: str, now: datetime) -> datetime:
    if period == "monthly":
        return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


def _evaluate_threshold_alerts(db: Session) -> list[SpendAlert]:
    now = datetime.now(timezone.utc)
    alerts = db.query(SpendAlert).filter(SpendAlert.status.in_(["active", "triggered"])).all()
    changed = False

    for alert in alerts:
        window_start = _period_start(alert.period, now)
        spend_query = db.query(func.coalesce(func.sum(ToolCall.cost_usd), 0)).filter(ToolCall.created_at >= window_start)
        if alert.scope_type == "agent" and alert.scope_id:
            spend_query = spend_query.filter(ToolCall.agent_id == alert.scope_id)

        current_spend = Decimal(spend_query.scalar() or 0)
        should_trigger = current_spend >= alert.threshold_usd

        if should_trigger and alert.status != "triggered":
            alert.status = "triggered"
            alert.last_triggered_at = now
            changed = True
        elif not should_trigger and alert.status == "triggered":
            alert.status = "active"
            changed = True

    if changed:
        db.commit()
        for alert in alerts:
            db.refresh(alert)

    return [alert for alert in alerts if alert.status == "triggered"]


def _refresh_spend_rollups(db: Session) -> None:
    aggregate_spend_data(db)
    evaluate_alert_rules(db)
    _evaluate_threshold_alerts(db)


@router.get("/summary")
def get_spend_summary(
    from_: datetime | None = Query(default=None, alias="from"),
    to: datetime | None = None,
    db: Session = Depends(get_db),
    _=Depends(require_roles("Admin", "Security", "Auditor")),
) -> dict:
    _refresh_spend_rollups(db)
    start, end = _resolve_window(from_, to)
    start_date = start.date()
    end_date = end.date()

    org_total = (
        db.query(func.coalesce(func.sum(SpendAggregate.total_usd), 0))
        .filter(
            SpendAggregate.scope_type == "org",
            SpendAggregate.scope_id == "org",
            SpendAggregate.aggregate_date >= start_date,
            SpendAggregate.aggregate_date <= end_date,
        )
        .scalar()
    )

    by_day_rows = (
        db.query(
            SpendAggregate.aggregate_date.label("day"),
            func.coalesce(func.sum(SpendAggregate.total_usd), 0).label("usd"),
        )
        .filter(
            SpendAggregate.scope_type == "org",
            SpendAggregate.scope_id == "org",
            SpendAggregate.aggregate_date >= start_date,
            SpendAggregate.aggregate_date <= end_date,
        )
        .group_by(SpendAggregate.aggregate_date)
        .order_by(SpendAggregate.aggregate_date.asc())
        .all()
    )

    top_agents_rows = (
        db.query(
            SpendAggregate.scope_id.label("agent_id"),
            func.coalesce(func.sum(SpendAggregate.total_usd), 0).label("usd"),
            func.coalesce(func.sum(SpendAggregate.usage_count), 0).label("tool_calls"),
        )
        .filter(
            SpendAggregate.scope_type == "agent",
            SpendAggregate.aggregate_date >= start_date,
            SpendAggregate.aggregate_date <= end_date,
        )
        .group_by(SpendAggregate.scope_id)
        .order_by(desc("usd"))
        .limit(10)
        .all()
    )
    agent_names = {str(agent.id): agent.name for agent in db.query(Agent).all()}

    top_providers_rows = (
        db.query(
            SpendAggregate.scope_id.label("provider"),
            func.coalesce(func.sum(SpendAggregate.total_usd), 0).label("usd"),
            func.coalesce(func.sum(SpendAggregate.usage_count), 0).label("usage_count"),
        )
        .filter(
            SpendAggregate.scope_type == "provider",
            SpendAggregate.aggregate_date >= start_date,
            SpendAggregate.aggregate_date <= end_date,
        )
        .group_by(SpendAggregate.scope_id)
        .order_by(desc("usd"))
        .limit(10)
        .all()
    )

    top_tools_rows = (
        db.query(
            Tool.name.label("tool"),
            func.coalesce(func.sum(ToolCall.cost_usd), 0).label("usd"),
        )
        .join(Tool, Tool.id == ToolCall.tool_id)
        .filter(ToolCall.created_at >= start, ToolCall.created_at <= end)
        .group_by(Tool.name)
        .order_by(desc("usd"))
        .limit(10)
        .all()
    )

    triggered_alerts = (
        db.query(Alert)
        .filter(Alert.status == "triggered", Alert.created_at >= start, Alert.created_at <= end)
        .order_by(Alert.created_at.desc())
        .limit(100)
        .all()
    )

    return {
        "total_usd": _to_float(org_total),
        "by_day": [{"day": row.day.isoformat(), "usd": _to_float(row.usd)} for row in by_day_rows],
        "top_agents": [
            {
                "agent_id": row.agent_id,
                "agent_name": agent_names.get(str(row.agent_id)),
                "usd": _to_float(row.usd),
                "tool_calls": int(row.tool_calls),
            }
            for row in top_agents_rows
        ],
        "top_providers": [
            {
                "provider": row.provider,
                "usd": _to_float(row.usd),
                "usage_count": int(row.usage_count),
            }
            for row in top_providers_rows
        ],
        "top_tools": [{"tool": row.tool, "usd": _to_float(row.usd)} for row in top_tools_rows],
        "alerts_triggered": [
            {
                "id": str(alert.id),
                "alert_type": alert.alert_type,
                "scope_type": alert.scope_type,
                "scope_id": alert.scope_id,
                "status": alert.status,
                "message": alert.message,
                "last_triggered_at": alert.last_triggered_at.isoformat() if alert.last_triggered_at else None,
                "created_at": alert.created_at.isoformat() if alert.created_at else None,
            }
            for alert in triggered_alerts
        ],
    }


@router.get("/providers")
def get_provider_spend(
    from_: datetime | None = Query(default=None, alias="from"),
    to: datetime | None = None,
    db: Session = Depends(get_db),
    _=Depends(require_roles("Admin", "Security", "Auditor")),
) -> dict:
    start, end = _resolve_window(from_, to)

    rows = (
        db.query(
            ProviderUsageEvent.provider.label("provider"),
            func.coalesce(func.sum(ProviderUsageEvent.cost_usd), 0).label("usd"),
            func.coalesce(func.sum(ProviderUsageEvent.tokens_in), 0).label("tokens_in"),
            func.coalesce(func.sum(ProviderUsageEvent.tokens_out), 0).label("tokens_out"),
            func.count(ProviderUsageEvent.id).label("events"),
            func.coalesce(func.sum(case((ProviderUsageEvent.shadow_ai_usage.is_(True), 1), else_=0)), 0).label("shadow_events"),
        )
        .filter(ProviderUsageEvent.timestamp >= start, ProviderUsageEvent.timestamp <= end)
        .group_by(ProviderUsageEvent.provider)
        .order_by(desc("usd"))
        .all()
    )

    return {
        "from": start.isoformat(),
        "to": end.isoformat(),
        "providers": [
            {
                "provider": row.provider,
                "usd": _to_float(row.usd),
                "tokens_in": int(row.tokens_in or 0),
                "tokens_out": int(row.tokens_out or 0),
                "events": int(row.events or 0),
                "shadow_events": int(row.shadow_events or 0),
            }
            for row in rows
        ],
    }


@router.get("/anomalies")
def get_spend_anomalies(
    from_: date | None = Query(default=None, alias="from"),
    to: date | None = None,
    db: Session = Depends(get_db),
    _=Depends(require_roles("Admin", "Security", "Auditor")),
) -> dict:
    _refresh_spend_rollups(db)
    today = datetime.now(timezone.utc).date()
    start_date = from_ or (today - timedelta(days=30))
    end_date = to or today

    rows = (
        db.query(SpendAnomaly)
        .filter(
            SpendAnomaly.anomaly_date >= start_date,
            SpendAnomaly.anomaly_date <= end_date,
        )
        .order_by(SpendAnomaly.anomaly_date.desc(), SpendAnomaly.created_at.desc())
        .limit(500)
        .all()
    )

    return {
        "from": start_date.isoformat(),
        "to": end_date.isoformat(),
        "anomalies": [
            {
                "id": str(row.id),
                "anomaly_date": row.anomaly_date.isoformat(),
                "scope_type": row.scope_type,
                "scope_id": row.scope_id,
                "current_usd": _to_float(row.current_usd),
                "baseline_usd": _to_float(row.baseline_usd),
                "spike_percent": _to_float(row.spike_percent),
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
            for row in rows
        ],
    }


@router.post("/alerts", response_model=SpendAlertOut)
def create_spend_alert(
    payload: SpendAlertCreate,
    db: Session = Depends(get_db),
    _=Depends(require_roles("Admin", "Security")),
) -> SpendAlert:
    alert = SpendAlert(
        scope_type=payload.scope_type,
        scope_id=payload.scope_id,
        period=payload.period,
        threshold_usd=payload.threshold_usd,
        status="active",
    )
    db.add(alert)
    db.commit()
    db.refresh(alert)
    return alert


@router.get("/alerts", response_model=list[SpendAlertOut])
def list_spend_alerts(
    db: Session = Depends(get_db),
    _=Depends(require_roles("Admin", "Security", "Auditor")),
) -> list[SpendAlert]:
    _evaluate_threshold_alerts(db)
    return db.query(SpendAlert).order_by(SpendAlert.created_at.desc()).all()
