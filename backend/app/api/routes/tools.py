from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_roles
from app.models.tool import Tool
from app.schemas.tool import ToolCreate, ToolOut, ToolUpdate

router = APIRouter(prefix="/tools", tags=["tools"])


@router.get("", response_model=list[ToolOut])
def list_tools(
    db: Session = Depends(get_db),
    _=Depends(require_roles("Admin", "Security", "Auditor")),
) -> list[Tool]:
    return db.query(Tool).order_by(Tool.created_at.desc()).all()


@router.post("", response_model=ToolOut)
def create_tool(
    payload: ToolCreate,
    db: Session = Depends(get_db),
    _=Depends(require_roles("Admin", "Security")),
) -> Tool:
    exists = db.query(Tool).filter(Tool.name == payload.name).first()
    if exists:
        raise HTTPException(status_code=400, detail="Tool name already exists")
    tool = Tool(**payload.model_dump())
    db.add(tool)
    db.commit()
    db.refresh(tool)
    return tool


@router.put("/{tool_id}", response_model=ToolOut)
def update_tool(
    tool_id: UUID,
    payload: ToolUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_roles("Admin", "Security")),
) -> Tool:
    tool = db.query(Tool).filter(Tool.id == tool_id).first()
    if not tool:
        raise HTTPException(status_code=404, detail="Tool not found")

    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(tool, key, value)

    db.commit()
    db.refresh(tool)
    return tool


@router.delete("/{tool_id}")
def delete_tool(
    tool_id: UUID,
    db: Session = Depends(get_db),
    _=Depends(require_roles("Admin", "Security")),
) -> dict:
    tool = db.query(Tool).filter(Tool.id == tool_id).first()
    if not tool:
        raise HTTPException(status_code=404, detail="Tool not found")

    db.delete(tool)
    db.commit()
    return {"status": "deleted"}
