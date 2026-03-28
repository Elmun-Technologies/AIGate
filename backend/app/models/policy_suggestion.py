import decimal
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class PolicySuggestion(Base):
    __tablename__ = "policy_suggestions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    suggested_yaml: Mapped[str] = mapped_column(Text, nullable=False)
    confidence_score: Mapped[decimal.Decimal] = mapped_column(
        Numeric(5, 2), nullable=False, default=decimal.Decimal("0.00")
    )
    source_metrics: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="open", index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
