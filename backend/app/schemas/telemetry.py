from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class TelemetryIngestRequest(BaseModel):
    provider: str = Field(min_length=2, max_length=50)
    api_key_hash: str = Field(min_length=4, max_length=255)
    model: str | None = Field(default=None, max_length=120)
    cost_usd: Decimal = Field(ge=0)
    source_hint: str = Field(default="unknown", max_length=30)
    tokens_in: int | None = Field(default=None, ge=0)
    tokens_out: int | None = Field(default=None, ge=0)

    @field_validator("provider")
    @classmethod
    def normalize_provider(cls, value: str) -> str:
        return value.strip().lower()

    @field_validator("source_hint")
    @classmethod
    def normalize_source_hint(cls, value: str) -> str:
        return value.strip().lower()


class TelemetryIngestResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    shadow_ai_usage: bool
    detected_source: str
    provider: str
    timestamp: datetime


class ShadowAIEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    provider: str
    api_key_fingerprint: str | None
    model: str | None
    detected_source: str
    source_hint: str | None
    cost_usd: Decimal
    tokens_in: int | None
    tokens_out: int | None
    timestamp: datetime
