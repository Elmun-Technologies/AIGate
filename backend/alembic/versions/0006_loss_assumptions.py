"""add prevented loss assumptions table

Revision ID: 0006_loss_assumptions
Revises: 0005_authority_anchor_growth
Create Date: 2026-02-19 11:45:00
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0006_loss_assumptions"
down_revision = "0005_authority_anchor_growth"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "loss_assumptions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("organization_id", sa.String(length=64), nullable=False),
        sa.Column("assumed_incident_cost_usd", sa.Numeric(precision=12, scale=2), nullable=False, server_default=sa.text("25000")),
        sa.Column("confidence", sa.Numeric(precision=4, scale=2), nullable=False, server_default=sa.text("0.35")),
        sa.Column("high_risk_threshold", sa.Integer(), nullable=False, server_default=sa.text("70")),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("updated_by_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("organization_id", name="uq_loss_assumptions_organization_id"),
    )
    op.create_index("ix_loss_assumptions_organization_id", "loss_assumptions", ["organization_id"])


def downgrade() -> None:
    op.drop_index("ix_loss_assumptions_organization_id", table_name="loss_assumptions")
    op.drop_table("loss_assumptions")
