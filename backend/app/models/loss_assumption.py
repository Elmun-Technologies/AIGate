import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Numeric, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class LossAssumption(Base):
    __tablename__ = "loss_assumptions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    organization_id: Mapped[str] = mapped_column(
        String(64), nullable=False, index=True, unique=True
    )
    assumed_incident_cost_usd: Mapped[float] = mapped_column(
        Numeric(12, 2), nullable=False, default=25000
    )
    confidence: Mapped[float] = mapped_column(
        Numeric(4, 2), nullable=False, default=0.35
    )
    high_risk_threshold: Mapped[int] = mapped_column(nullable=False, default=70)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    updated_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
