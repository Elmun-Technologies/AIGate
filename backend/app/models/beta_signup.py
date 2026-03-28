import uuid
from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class BetaSignup(Base):
    __tablename__ = "beta_signups"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    company_name: Mapped[str] = mapped_column(String(160), nullable=False)
    contact_email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    team_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    use_case: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(
        String(30), nullable=False, default="new", index=True
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
