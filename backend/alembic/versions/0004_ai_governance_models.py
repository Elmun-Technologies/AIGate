"""add ai governance tables

Revision ID: 0004_ai_governance_models
Revises: 0003_usage_aggregation_alerts
Create Date: 2026-02-18 01:30:00
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0004_ai_governance_models"
down_revision = "0003_usage_aggregation_alerts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ai_providers",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False, unique=True),
        sa.Column("type", sa.String(length=20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_ai_providers_name", "ai_providers", ["name"])

    op.create_table(
        "api_keys",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("provider_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("ai_providers.id"), nullable=False),
        sa.Column("fingerprint_hash", sa.String(length=128), nullable=False),
        sa.Column("masked_key", sa.String(length=12), nullable=False),
        sa.Column("discovered_from", sa.String(length=20), nullable=False),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("organization_id", "provider_id", "fingerprint_hash", name="uq_api_keys_org_provider_fingerprint"),
    )
    op.create_index("ix_api_keys_organization_id", "api_keys", ["organization_id"])
    op.create_index("ix_api_keys_provider_id", "api_keys", ["provider_id"])

    op.create_table(
        "ai_usage_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("api_key_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("api_keys.id"), nullable=False),
        sa.Column("provider_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("ai_providers.id"), nullable=False),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("agent_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("agents.id"), nullable=True),
        sa.Column("tool_call_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tool_calls.id"), nullable=True, unique=True),
        sa.Column("model", sa.String(length=120), nullable=True),
        sa.Column("endpoint", sa.String(length=255), nullable=False),
        sa.Column("prompt_tokens", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("completion_tokens", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("cost_usd", sa.Numeric(precision=12, scale=6), nullable=False),
        sa.Column("ip_address", sa.String(length=64), nullable=True),
        sa.Column("user_identifier", sa.Text(), nullable=True),
        sa.Column("detected_source", sa.String(length=20), nullable=False),
        sa.Column("source_hint", sa.String(length=30), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_ai_usage_events_api_key_id", "ai_usage_events", ["api_key_id"])
    op.create_index("ix_ai_usage_events_provider_id", "ai_usage_events", ["provider_id"])
    op.create_index("ix_ai_usage_events_organization_id", "ai_usage_events", ["organization_id"])
    op.create_index("ix_ai_usage_events_agent_id", "ai_usage_events", ["agent_id"])
    op.create_index("ix_ai_usage_events_created_at", "ai_usage_events", ["created_at"])

    op.create_table(
        "ai_billing_subscriptions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("provider_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("ai_providers.id"), nullable=False),
        sa.Column("detected_plan_name", sa.String(length=120), nullable=False),
        sa.Column("estimated_monthly_cost", sa.Numeric(precision=12, scale=6), nullable=False),
        sa.Column("billing_cycle", sa.String(length=20), nullable=False),
        sa.Column("first_detected_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("risk_level", sa.String(length=20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_ai_billing_subscriptions_organization_id", "ai_billing_subscriptions", ["organization_id"])
    op.create_index("ix_ai_billing_subscriptions_provider_id", "ai_billing_subscriptions", ["provider_id"])

    op.create_table(
        "ai_spend_alerts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("type", sa.String(length=40), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("severity", sa.String(length=20), nullable=False),
        sa.Column("payload_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_ai_spend_alerts_organization_id", "ai_spend_alerts", ["organization_id"])
    op.create_index("ix_ai_spend_alerts_type", "ai_spend_alerts", ["type"])
    op.create_index("ix_ai_spend_alerts_severity", "ai_spend_alerts", ["severity"])


def downgrade() -> None:
    op.drop_index("ix_ai_spend_alerts_severity", table_name="ai_spend_alerts")
    op.drop_index("ix_ai_spend_alerts_type", table_name="ai_spend_alerts")
    op.drop_index("ix_ai_spend_alerts_organization_id", table_name="ai_spend_alerts")
    op.drop_table("ai_spend_alerts")

    op.drop_index("ix_ai_billing_subscriptions_provider_id", table_name="ai_billing_subscriptions")
    op.drop_index("ix_ai_billing_subscriptions_organization_id", table_name="ai_billing_subscriptions")
    op.drop_table("ai_billing_subscriptions")

    op.drop_index("ix_ai_usage_events_created_at", table_name="ai_usage_events")
    op.drop_index("ix_ai_usage_events_agent_id", table_name="ai_usage_events")
    op.drop_index("ix_ai_usage_events_organization_id", table_name="ai_usage_events")
    op.drop_index("ix_ai_usage_events_provider_id", table_name="ai_usage_events")
    op.drop_index("ix_ai_usage_events_api_key_id", table_name="ai_usage_events")
    op.drop_table("ai_usage_events")

    op.drop_index("ix_api_keys_provider_id", table_name="api_keys")
    op.drop_index("ix_api_keys_organization_id", table_name="api_keys")
    op.drop_table("api_keys")

    op.drop_index("ix_ai_providers_name", table_name="ai_providers")
    op.drop_table("ai_providers")
