from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class AgentBase(BaseModel):
    name: str
    owner_email: str
    data_classification: str
    status: str = "active"


class AgentCreate(AgentBase):
    pass


class AgentUpdate(BaseModel):
    name: Optional[str] = None
    owner_email: Optional[str] = None
    data_classification: Optional[str] = None
    status: Optional[str] = None


class AgentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    owner_email: str
    data_classification: str
    status: str
    created_at: datetime


class AgentCreateResponse(AgentOut):
    api_key: str
