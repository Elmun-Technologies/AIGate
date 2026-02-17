import decimal
import uuid

from sqlalchemy import Date, DateTime, Numeric, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class SpendAnomaly(Base):
    __tablename__ = "spend_anomalies"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    anomaly_date: Mapped[Date] = mapped_column(Date, nullable=False, index=True)
    scope_type: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    scope_id: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    current_usd: Mapped[decimal.Decimal] = mapped_column(Numeric(12, 6), nullable=False)
    baseline_usd: Mapped[decimal.Decimal] = mapped_column(Numeric(12, 6), nullable=False)
    spike_percent: Mapped[decimal.Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
