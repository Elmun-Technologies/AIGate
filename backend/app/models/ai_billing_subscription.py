import decimal
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Numeric, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AIBillingSubscription(Base):
    __tablename__ = "ai_billing_subscriptions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False, index=True
    )
    provider_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("ai_providers.id"), nullable=False, index=True
    )
    detected_plan_name: Mapped[str] = mapped_column(String(120), nullable=False)
    estimated_monthly_cost: Mapped[decimal.Decimal] = mapped_column(
        Numeric(12, 6), nullable=False
    )
    billing_cycle: Mapped[str] = mapped_column(String(20), nullable=False)
    first_detected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    risk_level: Mapped[str] = mapped_column(String(20), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
