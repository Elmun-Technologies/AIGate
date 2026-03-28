"""add runtime authority, anchors, and growth tables

Revision ID: 0005_authority_anchor_growth
Revises: 0004_ai_governance_models
Create Date: 2026-02-19 00:10:00
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0005_authority_anchor_growth"
down_revision = "0004_ai_governance_models"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tool_calls", sa.Column("runtime_nonce", sa.String(length=80), nullable=True))
    op.add_column("tool_calls", sa.Column("runtime_auth_hash", sa.String(length=64), nullable=True))
    op.add_column("tool_calls", sa.Column("runtime_issued_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("tool_calls", sa.Column("runtime_expires_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("tool_calls", sa.Column("authorization_mode", sa.String(length=40), nullable=True))
    op.add_column("tool_calls", sa.Column("execution_attested_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_tool_calls_runtime_nonce", "tool_calls", ["runtime_nonce"])

    op.create_table(
        "audit_anchors",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("anchor_date", sa.Date(), nullable=False),
        sa.Column("merkle_root", sa.String(length=128), nullable=False),
        sa.Column("leaf_count", sa.Integer(), nullable=False),
        sa.Column("chain_head", sa.String(length=64), nullable=False),
        sa.Column("chain_tail", sa.String(length=64), nullable=False),
        sa.Column("anchor_backend", sa.String(length=32), nullable=False),
        sa.Column("anchor_ref", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("anchor_date", "anchor_backend", name="uq_audit_anchor_date_backend"),
    )
    op.create_index("ix_audit_anchors_anchor_date", "audit_anchors", ["anchor_date"])

    op.create_table(
        "policy_suggestions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("suggested_yaml", sa.Text(), nullable=False),
        sa.Column("confidence_score", sa.Numeric(precision=5, scale=2), nullable=False, server_default=sa.text("0.00")),
        sa.Column("source_metrics", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("status", sa.String(length=20), nullable=False, server_default=sa.text("'open'")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_policy_suggestions_status", "policy_suggestions", ["status"])

    op.create_table(
        "beta_signups",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("company_name", sa.String(length=160), nullable=False),
        sa.Column("contact_email", sa.String(length=255), nullable=False),
        sa.Column("team_size", sa.Integer(), nullable=True),
        sa.Column("use_case", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False, server_default=sa.text("'new'")),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_beta_signups_contact_email", "beta_signups", ["contact_email"])
    op.create_index("ix_beta_signups_status", "beta_signups", ["status"])


def downgrade() -> None:
    op.drop_index("ix_beta_signups_status", table_name="beta_signups")
    op.drop_index("ix_beta_signups_contact_email", table_name="beta_signups")
    op.drop_table("beta_signups")

    op.drop_index("ix_policy_suggestions_status", table_name="policy_suggestions")
    op.drop_table("policy_suggestions")

    op.drop_index("ix_audit_anchors_anchor_date", table_name="audit_anchors")
    op.drop_table("audit_anchors")

    op.drop_index("ix_tool_calls_runtime_nonce", table_name="tool_calls")
    op.drop_column("tool_calls", "execution_attested_at")
    op.drop_column("tool_calls", "authorization_mode")
    op.drop_column("tool_calls", "runtime_expires_at")
    op.drop_column("tool_calls", "runtime_issued_at")
    op.drop_column("tool_calls", "runtime_auth_hash")
    op.drop_column("tool_calls", "runtime_nonce")
