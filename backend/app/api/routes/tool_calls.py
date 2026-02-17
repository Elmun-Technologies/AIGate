from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_roles
from app.models.tool_call import ToolCall
from app.schemas.tool_call import ToolCallOut

router = APIRouter(tags=["tool-calls"])


@router.get("/tool-calls", response_model=list[ToolCallOut])
def list_tool_calls(
    status: str | None = None,
    db: Session = Depends(get_db),
    _=Depends(require_roles("Admin", "Security", "Auditor")),
) -> list[ToolCall]:
    query = db.query(ToolCall)
    if status:
        query = query.filter(ToolCall.status == status)
    return query.order_by(ToolCall.created_at.desc()).limit(500).all()
