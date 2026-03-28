from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class AIProviderUsageOut(BaseModel):
    provider: str
    provider_type: str
    total_usd: Decimal
    events: int
    unique_keys: int
    unique_users: int


class APIKeyOut(BaseModel):
    id: UUID
    organization_id: UUID
    provider: str
    masked_key: str
    discovered_from: str
    first_seen_at: datetime
    last_seen_at: datetime
    status: str
    total_usd: Decimal
    events: int


class AIBillingSubscriptionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    organization_id: UUID
    provider_id: UUID
    detected_plan_name: str
    estimated_monthly_cost: Decimal
    billing_cycle: str
    first_detected_at: datetime
    last_seen_at: datetime
    risk_level: str
    created_at: datetime


class AISpendAlertOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    organization_id: UUID
    type: str
    message: str
    severity: str
    payload_json: dict
    created_at: datetime
    resolved_at: datetime | None


class ResolveAISpendAlertRequest(BaseModel):
    reason: str
    owner: str | None = None
    status: str = "resolved"
