import decimal
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ToolCall(Base):
    __tablename__ = "tool_calls"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    agent_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("agents.id"), nullable=False
    )
    tool_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tools.id"), nullable=False
    )
    request_json_redacted: Mapped[dict] = mapped_column(JSONB, nullable=False)
    response_json_redacted: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    risk_score: Mapped[int] = mapped_column(Integer, nullable=False)
    decision_reason: Mapped[str] = mapped_column(Text, nullable=False)
    provider: Mapped[str | None] = mapped_column(String(100), nullable=True)
    model: Mapped[str | None] = mapped_column(String(120), nullable=True)
    tokens_in: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tokens_out: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cost_usd: Mapped[decimal.Decimal | None] = mapped_column(
        Numeric(12, 6), nullable=True
    )
    cost_source: Mapped[str | None] = mapped_column(String(20), nullable=True)
    runtime_nonce: Mapped[str | None] = mapped_column(
        String(80), nullable=True, index=True
    )
    runtime_auth_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    runtime_issued_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    runtime_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    authorization_mode: Mapped[str | None] = mapped_column(String(40), nullable=True)
    execution_attested_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
