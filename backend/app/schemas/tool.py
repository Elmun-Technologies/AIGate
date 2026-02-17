from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class ToolCreate(BaseModel):
    name: str
    base_url: str
    method: str = "POST"
    risk_level: str


class ToolUpdate(BaseModel):
    base_url: Optional[str] = None
    method: Optional[str] = None
    risk_level: Optional[str] = None


class ToolOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    base_url: str
    method: str
    risk_level: str
    created_at: datetime
