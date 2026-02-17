from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class PolicyCreate(BaseModel):
    name: str
    version: int
    yaml_text: str
    is_active: bool = False


class PolicyUpdate(BaseModel):
    name: Optional[str] = None
    version: Optional[int] = None
    yaml_text: Optional[str] = None
    is_active: Optional[bool] = None


class PolicyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    version: int
    yaml_text: str
    is_active: bool
    created_at: datetime
