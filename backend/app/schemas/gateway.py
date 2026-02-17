from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field


class ToolCallRequest(BaseModel):
    agent_api_key: str
    agent_id: UUID
    prompt: str = ""
    tool: str
    args: dict[str, Any] = Field(default_factory=dict)


class ToolCallResponse(BaseModel):
    status: str
    tool_call_id: UUID
    approval_request_id: UUID | None = None
    risk_score: int
    decision_reason: str
    result: dict[str, Any] | None = None
