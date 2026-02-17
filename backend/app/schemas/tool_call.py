from decimal import Decimal
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class ToolCallOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    agent_id: UUID
    tool_id: UUID
    request_json_redacted: dict
    response_json_redacted: dict | None
    status: str
    risk_score: int
    decision_reason: str
    provider: str | None = None
    model: str | None = None
    tokens_in: int | None = None
    tokens_out: int | None = None
    cost_usd: Decimal | None = None
    cost_source: str | None = None
    created_at: datetime
