from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_roles
from app.core.security import generate_api_key, hash_api_key
from app.models.agent import Agent
from app.schemas.agent import AgentCreate, AgentCreateResponse, AgentOut, AgentUpdate

router = APIRouter(prefix="/agents", tags=["agents"])


@router.get("", response_model=list[AgentOut])
def list_agents(
    db: Session = Depends(get_db),
    _=Depends(require_roles("Admin", "Security", "Auditor")),
) -> list[Agent]:
    return db.query(Agent).order_by(Agent.created_at.desc()).all()


@router.post("", response_model=AgentCreateResponse)
def create_agent(
    payload: AgentCreate,
    db: Session = Depends(get_db),
    _=Depends(require_roles("Admin", "Security")),
) -> AgentCreateResponse:
    exists = db.query(Agent).filter(Agent.name == payload.name).first()
    if exists:
        raise HTTPException(status_code=400, detail="Agent name already exists")

    api_key = generate_api_key()
    agent = Agent(
        name=payload.name,
        owner_email=payload.owner_email,
        data_classification=payload.data_classification,
        status=payload.status,
        api_key_hash=hash_api_key(api_key),
    )
    db.add(agent)
    db.commit()
    db.refresh(agent)

    return AgentCreateResponse(
        id=agent.id,
        name=agent.name,
        owner_email=agent.owner_email,
        data_classification=agent.data_classification,
        status=agent.status,
        created_at=agent.created_at,
        api_key=api_key,
    )


@router.get("/{agent_id}", response_model=AgentOut)
def get_agent(
    agent_id: UUID,
    db: Session = Depends(get_db),
    _=Depends(require_roles("Admin", "Security", "Auditor")),
) -> Agent:
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    return agent


@router.put("/{agent_id}", response_model=AgentOut)
def update_agent(
    agent_id: UUID,
    payload: AgentUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_roles("Admin", "Security")),
) -> Agent:
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(agent, key, value)

    db.commit()
    db.refresh(agent)
    return agent


@router.delete("/{agent_id}")
def delete_agent(
    agent_id: UUID,
    db: Session = Depends(get_db),
    _=Depends(require_roles("Admin", "Security")),
) -> dict:
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    db.delete(agent)
    db.commit()
    return {"status": "deleted"}
