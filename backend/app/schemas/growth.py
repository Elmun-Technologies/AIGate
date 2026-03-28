from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class BetaOnboardRequest(BaseModel):
    company_name: str = Field(min_length=2, max_length=160)
    contact_email: str = Field(min_length=5, max_length=255)
    team_size: int | None = Field(default=None, ge=1, le=100000)
    use_case: str = Field(min_length=5, max_length=5000)
    notes: str | None = Field(default=None, max_length=5000)


class BetaOnboardResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    status: str
    created_at: datetime
