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
