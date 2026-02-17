from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import and_, func
from sqlalchemy.orm import Session

from app.models.spend_aggregate import SpendAggregate
from app.models.provider_usage_event import ProviderUsageEvent


def _safe_decimal(value: Decimal | None) -> Decimal:
    if value is None:
        return Decimal("0")
    return Decimal(value)


def aggregate_spend_data(db: Session, lookback_days: int = 35) -> dict:
    today = datetime.now(timezone.utc).date()
    start_date = today - timedelta(days=lookback_days)
    start_dt = datetime.combine(start_date, datetime.min.time(), tzinfo=timezone.utc)

    db.query(SpendAggregate).filter(SpendAggregate.aggregate_date >= start_date).delete(synchronize_session=False)

    org_rows = (
        db.query(
            func.date_trunc("day", ProviderUsageEvent.timestamp).label("day"),
            func.coalesce(func.sum(ProviderUsageEvent.cost_usd), 0).label("total_usd"),
            func.coalesce(func.sum(ProviderUsageEvent.tokens_in), 0).label("tokens_in"),
            func.coalesce(func.sum(ProviderUsageEvent.tokens_out), 0).label("tokens_out"),
            func.count(ProviderUsageEvent.id).label("usage_count"),
        )
        .filter(ProviderUsageEvent.timestamp >= start_dt)
        .group_by(func.date_trunc("day", ProviderUsageEvent.timestamp))
        .all()
    )

    agent_rows = (
        db.query(
            func.date_trunc("day", ProviderUsageEvent.timestamp).label("day"),
            ProviderUsageEvent.agent_id.label("agent_id"),
            func.coalesce(func.sum(ProviderUsageEvent.cost_usd), 0).label("total_usd"),
            func.coalesce(func.sum(ProviderUsageEvent.tokens_in), 0).label("tokens_in"),
            func.coalesce(func.sum(ProviderUsageEvent.tokens_out), 0).label("tokens_out"),
            func.count(ProviderUsageEvent.id).label("usage_count"),
        )
        .filter(ProviderUsageEvent.timestamp >= start_dt, ProviderUsageEvent.agent_id.isnot(None))
        .group_by(func.date_trunc("day", ProviderUsageEvent.timestamp), ProviderUsageEvent.agent_id)
        .all()
    )

    provider_rows = (
        db.query(
            func.date_trunc("day", ProviderUsageEvent.timestamp).label("day"),
            ProviderUsageEvent.provider.label("provider"),
            func.coalesce(func.sum(ProviderUsageEvent.cost_usd), 0).label("total_usd"),
            func.coalesce(func.sum(ProviderUsageEvent.tokens_in), 0).label("tokens_in"),
            func.coalesce(func.sum(ProviderUsageEvent.tokens_out), 0).label("tokens_out"),
            func.count(ProviderUsageEvent.id).label("usage_count"),
        )
        .filter(ProviderUsageEvent.timestamp >= start_dt)
        .group_by(func.date_trunc("day", ProviderUsageEvent.timestamp), ProviderUsageEvent.provider)
        .all()
    )

    inserted = 0
    for row in org_rows:
        db.add(
            SpendAggregate(
                aggregate_date=row.day.date(),
                scope_type="org",
                scope_id="org",
                total_usd=_safe_decimal(row.total_usd),
                tokens_in=int(row.tokens_in or 0),
                tokens_out=int(row.tokens_out or 0),
                usage_count=int(row.usage_count or 0),
            )
        )
        inserted += 1

    for row in agent_rows:
        db.add(
            SpendAggregate(
                aggregate_date=row.day.date(),
                scope_type="agent",
                scope_id=str(row.agent_id),
                total_usd=_safe_decimal(row.total_usd),
                tokens_in=int(row.tokens_in or 0),
                tokens_out=int(row.tokens_out or 0),
                usage_count=int(row.usage_count or 0),
            )
        )
        inserted += 1

    for row in provider_rows:
        db.add(
            SpendAggregate(
                aggregate_date=row.day.date(),
                scope_type="provider",
                scope_id=str(row.provider),
                total_usd=_safe_decimal(row.total_usd),
                tokens_in=int(row.tokens_in or 0),
                tokens_out=int(row.tokens_out or 0),
                usage_count=int(row.usage_count or 0),
            )
        )
        inserted += 1

    db.commit()
    return {"status": "ok", "inserted": inserted, "start_date": start_date.isoformat(), "end_date": today.isoformat()}


def get_scope_baseline_average(
    db: Session,
    *,
    scope_type: str,
    scope_id: str,
    current_date: date,
    window_days: int = 7,
) -> Decimal:
    baseline_start = current_date - timedelta(days=window_days)
    baseline_end = current_date - timedelta(days=1)
    baseline_avg = (
        db.query(func.avg(SpendAggregate.total_usd))
        .filter(
            SpendAggregate.scope_type == scope_type,
            SpendAggregate.scope_id == scope_id,
            and_(SpendAggregate.aggregate_date >= baseline_start, SpendAggregate.aggregate_date <= baseline_end),
        )
        .scalar()
    )
    if baseline_avg is None:
        return Decimal("0")
    return Decimal(baseline_avg)
