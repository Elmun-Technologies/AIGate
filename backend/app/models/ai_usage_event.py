import decimal
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AIUsageEvent(Base):
    __tablename__ = "ai_usage_events"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    api_key_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("api_keys.id"), nullable=False, index=True
    )
    provider_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("ai_providers.id"), nullable=False, index=True
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False, index=True
    )
    agent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("agents.id"), nullable=True, index=True
    )
    tool_call_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tool_calls.id"), nullable=True, unique=True
    )
    model: Mapped[str | None] = mapped_column(String(120), nullable=True)
    endpoint: Mapped[str] = mapped_column(String(255), nullable=False)
    prompt_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cost_usd: Mapped[decimal.Decimal] = mapped_column(
        Numeric(12, 6), nullable=False, default=decimal.Decimal("0")
    )
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_identifier: Mapped[str | None] = mapped_column(Text, nullable=True)
    detected_source: Mapped[str] = mapped_column(
        String(20), nullable=False, default="unknown"
    )
    source_hint: Mapped[str | None] = mapped_column(String(30), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )
