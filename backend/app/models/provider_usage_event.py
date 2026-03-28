import decimal
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Numeric, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ProviderUsageEvent(Base):
    __tablename__ = "provider_usage_events"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    agent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("agents.id"), nullable=True
    )
    tool_call_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tool_calls.id"), nullable=True, unique=True
    )
    provider: Mapped[str] = mapped_column(String(50), nullable=False)
    api_key_fingerprint: Mapped[str | None] = mapped_column(String(255), nullable=True)
    model: Mapped[str | None] = mapped_column(String(120), nullable=True)
    detected_source: Mapped[str] = mapped_column(String(20), nullable=False)
    source_hint: Mapped[str | None] = mapped_column(String(30), nullable=True)
    cost_usd: Mapped[decimal.Decimal] = mapped_column(
        Numeric(12, 6), nullable=False, default=decimal.Decimal("0")
    )
    tokens_in: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tokens_out: Mapped[int | None] = mapped_column(Integer, nullable=True)
    shadow_ai_usage: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )
