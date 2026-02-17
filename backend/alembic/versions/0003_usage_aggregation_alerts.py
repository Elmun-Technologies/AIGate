"""provider usage, spend aggregates, anomalies, alerts

Revision ID: 0003_usage_aggregation_alerts
Revises: 0002_spend_tracing
Create Date: 2026-02-18 00:30:00
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0003_usage_aggregation_alerts"
down_revision = "0002_spend_tracing"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "provider_usage_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("agent_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("agents.id"), nullable=True),
        sa.Column("tool_call_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tool_calls.id"), nullable=True, unique=True),
        sa.Column("provider", sa.String(length=50), nullable=False),
        sa.Column("api_key_fingerprint", sa.String(length=255), nullable=True),
        sa.Column("model", sa.String(length=120), nullable=True),
        sa.Column("detected_source", sa.String(length=20), nullable=False),
        sa.Column("source_hint", sa.String(length=30), nullable=True),
        sa.Column("cost_usd", sa.Numeric(precision=12, scale=6), nullable=False),
        sa.Column("tokens_in", sa.Integer(), nullable=True),
        sa.Column("tokens_out", sa.Integer(), nullable=True),
        sa.Column("shadow_ai_usage", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("timestamp", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_provider_usage_events_timestamp", "provider_usage_events", ["timestamp"])
    op.create_index("ix_provider_usage_events_provider", "provider_usage_events", ["provider"])
    op.create_index("ix_provider_usage_events_api_key_fingerprint", "provider_usage_events", ["api_key_fingerprint"])
    op.create_index("ix_provider_usage_events_shadow_ai_usage", "provider_usage_events", ["shadow_ai_usage"])

    op.create_table(
        "spend_aggregates",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("aggregate_date", sa.Date(), nullable=False),
        sa.Column("scope_type", sa.String(length=20), nullable=False),
        sa.Column("scope_id", sa.String(length=120), nullable=False),
        sa.Column("total_usd", sa.Numeric(precision=12, scale=6), nullable=False),
        sa.Column("tokens_in", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("tokens_out", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("usage_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("aggregate_date", "scope_type", "scope_id", name="uq_spend_aggregate_scope_date"),
    )
    op.create_index("ix_spend_aggregates_aggregate_date", "spend_aggregates", ["aggregate_date"])
    op.create_index("ix_spend_aggregates_scope_type", "spend_aggregates", ["scope_type"])
    op.create_index("ix_spend_aggregates_scope_id", "spend_aggregates", ["scope_id"])

    op.create_table(
        "spend_anomalies",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("anomaly_date", sa.Date(), nullable=False),
        sa.Column("scope_type", sa.String(length=20), nullable=False),
        sa.Column("scope_id", sa.String(length=120), nullable=False),
        sa.Column("current_usd", sa.Numeric(precision=12, scale=6), nullable=False),
        sa.Column("baseline_usd", sa.Numeric(precision=12, scale=6), nullable=False),
        sa.Column("spike_percent", sa.Numeric(precision=10, scale=2), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_spend_anomalies_anomaly_date", "spend_anomalies", ["anomaly_date"])
    op.create_index("ix_spend_anomalies_scope_type", "spend_anomalies", ["scope_type"])
    op.create_index("ix_spend_anomalies_scope_id", "spend_anomalies", ["scope_id"])

    op.create_table(
        "alerts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("alert_type", sa.String(length=80), nullable=False),
        sa.Column("scope_type", sa.String(length=30), nullable=False),
        sa.Column("scope_id", sa.String(length=255), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default=sa.text("'triggered'")),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("payload_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("last_triggered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_alerts_alert_type", "alerts", ["alert_type"])
    op.create_index("ix_alerts_scope_type", "alerts", ["scope_type"])
    op.create_index("ix_alerts_scope_id", "alerts", ["scope_id"])
    op.create_index("ix_alerts_status", "alerts", ["status"])


def downgrade() -> None:
    op.drop_index("ix_alerts_status", table_name="alerts")
    op.drop_index("ix_alerts_scope_id", table_name="alerts")
    op.drop_index("ix_alerts_scope_type", table_name="alerts")
    op.drop_index("ix_alerts_alert_type", table_name="alerts")
    op.drop_table("alerts")

    op.drop_index("ix_spend_anomalies_scope_id", table_name="spend_anomalies")
    op.drop_index("ix_spend_anomalies_scope_type", table_name="spend_anomalies")
    op.drop_index("ix_spend_anomalies_anomaly_date", table_name="spend_anomalies")
    op.drop_table("spend_anomalies")

    op.drop_index("ix_spend_aggregates_scope_id", table_name="spend_aggregates")
    op.drop_index("ix_spend_aggregates_scope_type", table_name="spend_aggregates")
    op.drop_index("ix_spend_aggregates_aggregate_date", table_name="spend_aggregates")
    op.drop_table("spend_aggregates")

    op.drop_index("ix_provider_usage_events_shadow_ai_usage", table_name="provider_usage_events")
    op.drop_index("ix_provider_usage_events_api_key_fingerprint", table_name="provider_usage_events")
    op.drop_index("ix_provider_usage_events_provider", table_name="provider_usage_events")
    op.drop_index("ix_provider_usage_events_timestamp", table_name="provider_usage_events")
    op.drop_table("provider_usage_events")
