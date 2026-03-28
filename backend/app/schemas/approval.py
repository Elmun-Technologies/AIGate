from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class ApprovalAction(BaseModel):
    reason: str


class ApprovalOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tool_call_id: UUID
    status: str
    approver_user_id: UUID | None
    reason: str | None
    created_at: datetime
    resolved_at: datetime | None
    risk_score: int | None = None
    decision_reason: str | None = None
    tool_name: str | None = None
    destination_domain: str | None = None
    risk_breakdown: list[dict] | None = None
    payload_preview: dict | None = None
