import uuid
from datetime import datetime

from sqlalchemy import Date, DateTime, Integer, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AuditAnchor(Base):
    __tablename__ = "audit_anchors"
    __table_args__ = (
        UniqueConstraint(
            "anchor_date", "anchor_backend", name="uq_audit_anchor_date_backend"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    anchor_date: Mapped[Date] = mapped_column(Date, nullable=False, index=True)
    merkle_root: Mapped[str] = mapped_column(String(128), nullable=False)
    leaf_count: Mapped[int] = mapped_column(Integer, nullable=False)
    chain_head: Mapped[str] = mapped_column(String(64), nullable=False)
    chain_tail: Mapped[str] = mapped_column(String(64), nullable=False)
    anchor_backend: Mapped[str] = mapped_column(
        String(32), nullable=False, default="local_notary"
    )
    anchor_ref: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
