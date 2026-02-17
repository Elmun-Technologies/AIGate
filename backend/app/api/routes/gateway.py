from fastapi import APIRouter, Depends
from rq import Queue
from sqlalchemy.orm import Session

from app.api.deps import get_db, get_rq_queue
from app.schemas.gateway import ToolCallRequest, ToolCallResponse
from app.services.gateway_service import process_gateway_tool_call

router = APIRouter(prefix="/gateway", tags=["gateway"])


@router.post("/tool-call", response_model=ToolCallResponse)
def gateway_tool_call(
    payload: ToolCallRequest,
    db: Session = Depends(get_db),
    queue: Queue = Depends(get_rq_queue),
) -> dict:
    return process_gateway_tool_call(db, queue, payload)
