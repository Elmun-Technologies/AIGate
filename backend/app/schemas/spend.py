from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, field_validator, model_validator


class SpendAlertCreate(BaseModel):
    scope_type: str
    scope_id: UUID | None = None
    period: str
    threshold_usd: Decimal

    @field_validator("scope_type")
    @classmethod
    def validate_scope_type(cls, value: str) -> str:
        normalized = value.lower()
        if normalized not in {"agent", "org"}:
            raise ValueError("scope_type must be agent or org")
        return normalized

    @field_validator("period")
    @classmethod
    def validate_period(cls, value: str) -> str:
        normalized = value.lower()
        if normalized not in {"daily", "monthly"}:
            raise ValueError("period must be daily or monthly")
        return normalized

    @model_validator(mode="after")
    def validate_scope_id(self) -> "SpendAlertCreate":
        if self.scope_type == "agent" and self.scope_id is None:
            raise ValueError("scope_id is required when scope_type is agent")
        if self.scope_type == "org":
            self.scope_id = None
        return self


class SpendAlertOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    scope_type: str
    scope_id: UUID | None
    period: str
    threshold_usd: Decimal
    status: str
    last_triggered_at: datetime | None
    created_at: datetime
