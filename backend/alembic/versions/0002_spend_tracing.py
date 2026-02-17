"""add spend tracing metadata and alerts

Revision ID: 0002_spend_tracing
Revises: 0001_initial
Create Date: 2026-02-18 00:00:00
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0002_spend_tracing"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tool_calls", sa.Column("provider", sa.String(length=100), nullable=True))
    op.add_column("tool_calls", sa.Column("model", sa.String(length=120), nullable=True))
    op.add_column("tool_calls", sa.Column("tokens_in", sa.Integer(), nullable=True))
    op.add_column("tool_calls", sa.Column("tokens_out", sa.Integer(), nullable=True))
    op.add_column("tool_calls", sa.Column("cost_usd", sa.Numeric(precision=12, scale=6), nullable=True))
    op.add_column("tool_calls", sa.Column("cost_source", sa.String(length=20), nullable=True))

    op.create_table(
        "spend_alerts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("scope_type", sa.String(length=20), nullable=False),
        sa.Column("scope_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("period", sa.String(length=20), nullable=False),
        sa.Column("threshold_usd", sa.Numeric(precision=12, scale=6), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("last_triggered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_spend_alerts_status", "spend_alerts", ["status"])
    op.create_index("ix_spend_alerts_scope_type", "spend_alerts", ["scope_type"])


def downgrade() -> None:
    op.drop_index("ix_spend_alerts_scope_type", table_name="spend_alerts")
    op.drop_index("ix_spend_alerts_status", table_name="spend_alerts")
    op.drop_table("spend_alerts")

    op.drop_column("tool_calls", "cost_source")
    op.drop_column("tool_calls", "cost_usd")
    op.drop_column("tool_calls", "tokens_out")
    op.drop_column("tool_calls", "tokens_in")
    op.drop_column("tool_calls", "model")
    op.drop_column("tool_calls", "provider")
