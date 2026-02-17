from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class ORMBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class UserOut(ORMBase):
    id: UUID
    email: str
    role: str
    created_at: datetime
