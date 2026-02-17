from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import and_
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.alert import Alert
from app.models.spend_aggregate import SpendAggregate
from app.models.spend_anomaly import SpendAnomaly
from app.services.spend_aggregation import get_scope_baseline_average


def _upsert_triggered_alert(
    db: Session,
    *,
    alert_type: str,
    scope_type: str,
    scope_id: str | None,
    message: str,
    payload_json: dict,
) -> Alert:
    now = datetime.now(timezone.utc)
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    existing = (
        db.query(Alert)
        .filter(
            Alert.alert_type == alert_type,
            Alert.scope_type == scope_type,
            Alert.scope_id == scope_id,
            Alert.created_at >= day_start,
        )
        .first()
    )
    if existing:
        existing.status = "triggered"
        existing.message = message
        existing.payload_json = payload_json
        existing.last_triggered_at = now
        db.flush()
        return existing

    alert = Alert(
        alert_type=alert_type,
        scope_type=scope_type,
        scope_id=scope_id,
        status="triggered",
        message=message,
        payload_json=payload_json,
        last_triggered_at=now,
    )
    db.add(alert)
    db.flush()
    return alert


def create_unknown_key_alert(db: Session, *, api_key_fingerprint: str, provider: str, cost_usd: Decimal) -> Alert:
    return _upsert_triggered_alert(
        db,
        alert_type="unknown_api_key_detected",
        scope_type="api_key",
        scope_id=api_key_fingerprint,
        message=f"Unknown API key fingerprint detected for provider {provider}",
        payload_json={
            "provider": provider,
            "api_key_fingerprint": api_key_fingerprint,
            "cost_usd": float(cost_usd),
        },
    )


def evaluate_alert_rules(db: Session) -> dict:
    today = datetime.now(timezone.utc).date()
    triggered = 0

    today_org = (
        db.query(SpendAggregate)
        .filter(SpendAggregate.aggregate_date == today, SpendAggregate.scope_type == "org", SpendAggregate.scope_id == "org")
        .first()
    )
    if today_org and Decimal(today_org.total_usd) > settings.SPEND_DAILY_THRESHOLD_USD:
        _upsert_triggered_alert(
            db,
            alert_type="daily_threshold_exceeded",
            scope_type="org",
            scope_id="org",
            message="Organization daily AI spend threshold exceeded",
            payload_json={
                "aggregate_date": today.isoformat(),
                "total_usd": float(today_org.total_usd),
                "threshold_usd": float(settings.SPEND_DAILY_THRESHOLD_USD),
            },
        )
        triggered += 1

    db.query(SpendAnomaly).filter(SpendAnomaly.anomaly_date == today).delete(synchronize_session=False)

    current_rows = (
        db.query(SpendAggregate)
        .filter(
            SpendAggregate.aggregate_date == today,
            SpendAggregate.scope_type.in_(["org", "agent", "provider"]),
        )
        .all()
    )

    for row in current_rows:
        baseline = get_scope_baseline_average(
            db,
            scope_type=row.scope_type,
            scope_id=row.scope_id,
            current_date=today,
            window_days=7,
        )
        if baseline <= 0:
            continue
        spike_percent = (Decimal(row.total_usd) / baseline) * Decimal("100")
        if spike_percent <= settings.SPEND_SPIKE_PERCENT:
            continue

        anomaly = SpendAnomaly(
            anomaly_date=today,
            scope_type=row.scope_type,
            scope_id=row.scope_id,
            current_usd=Decimal(row.total_usd),
            baseline_usd=baseline,
            spike_percent=spike_percent.quantize(Decimal("0.01")),
        )
        db.add(anomaly)
        _upsert_triggered_alert(
            db,
            alert_type="sudden_usage_spike",
            scope_type=row.scope_type,
            scope_id=row.scope_id,
            message=f"Usage spike detected for {row.scope_type}={row.scope_id}",
            payload_json={
                "aggregate_date": today.isoformat(),
                "current_usd": float(row.total_usd),
                "baseline_usd": float(baseline),
                "spike_percent": float(spike_percent),
            },
        )
        triggered += 1

    db.commit()
    return {"status": "ok", "triggered": triggered}
