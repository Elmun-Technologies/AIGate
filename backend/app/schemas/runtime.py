from uuid import UUID

from pydantic import BaseModel, Field


class RuntimeVerifyRequest(BaseModel):
    tool_call_id: UUID
    expected_tool: str = Field(min_length=2)
    runtime_token: str = Field(min_length=20)


class RuntimeVerifyResponse(BaseModel):
    valid: bool
    reason: str
