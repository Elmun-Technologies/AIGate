from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class AuditEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    stream_id: str
    event_type: str
    payload_redacted_json: dict
    decision: str
    risk_score: int
    prev_hash: str | None
    chain_hash: str
    created_at: datetime
