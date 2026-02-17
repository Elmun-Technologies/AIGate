from uuid import UUID

from fastapi import APIRouter, Depends
from rq import Queue
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db, get_rq_queue, require_roles
from app.models.approval_request import ApprovalRequest
from app.models.user import User
from app.schemas.approval import ApprovalAction, ApprovalOut
from app.services.approval_service import approve_request, reject_request

router = APIRouter(prefix="/approvals", tags=["approvals"])


@router.get("", response_model=list[ApprovalOut])
def list_approvals(
    status: str | None = "pending",
    db: Session = Depends(get_db),
    _=Depends(require_roles("Admin", "Security", "Auditor")),
) -> list[ApprovalRequest]:
    query = db.query(ApprovalRequest)
    if status:
        query = query.filter(ApprovalRequest.status == status)
    return query.order_by(ApprovalRequest.created_at.desc()).all()


@router.post("/{approval_id}/approve", response_model=ApprovalOut)
def approve(
    approval_id: UUID,
    payload: ApprovalAction,
    db: Session = Depends(get_db),
    queue: Queue = Depends(get_rq_queue),
    user: User = Depends(get_current_user),
    _=Depends(require_roles("Admin", "Security")),
) -> ApprovalRequest:
    return approve_request(db=db, queue=queue, approval_id=approval_id, approver_id=user.id, reason=payload.reason)


@router.post("/{approval_id}/reject", response_model=ApprovalOut)
def reject(
    approval_id: UUID,
    payload: ApprovalAction,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _=Depends(require_roles("Admin", "Security")),
) -> ApprovalRequest:
    return reject_request(db=db, approval_id=approval_id, approver_id=user.id, reason=payload.reason)
