import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class APIKey(Base):
    __tablename__ = "api_keys"
    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "provider_id",
            "fingerprint_hash",
            name="uq_api_keys_org_provider_fingerprint",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False, index=True
    )
    provider_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("ai_providers.id"), nullable=False, index=True
    )
    fingerprint_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    masked_key: Mapped[str] = mapped_column(String(12), nullable=False)
    discovered_from: Mapped[str] = mapped_column(String(20), nullable=False)
    first_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="unknown")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
