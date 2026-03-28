from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_roles
from app.models.tool_call import ToolCall
from app.schemas.runtime import RuntimeVerifyRequest, RuntimeVerifyResponse
from app.services.runtime_authority import verify_runtime_token

router = APIRouter(prefix="/runtime", tags=["runtime"])


@router.post("/verify", response_model=RuntimeVerifyResponse)
def verify_runtime(
    payload: RuntimeVerifyRequest,
    db: Session = Depends(get_db),
    _=Depends(require_roles("Admin", "Security", "Auditor")),
) -> dict:
    tool_call = db.query(ToolCall).filter(ToolCall.id == payload.tool_call_id).first()
    if not tool_call:
        raise HTTPException(status_code=404, detail="Tool call not found")
    valid, reason = verify_runtime_token(
        tool_call,
        token=payload.runtime_token,
        expected_tool=payload.expected_tool,
    )
    return {"valid": bool(valid), "reason": reason}
