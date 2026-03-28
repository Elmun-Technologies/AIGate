from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.ai_provider import AIProvider
from app.core.security import get_password_hash, hash_api_key
from app.models.agent import Agent
from app.models.policy import Policy
from app.models.loss_assumption import LossAssumption
from app.models.tool import Tool
from app.models.user import User
from app.services.policy_templates import POLICY_TEMPLATE_CONFIDENTIAL_APPROVAL_REQUIRED

DEFAULT_POLICY_YAML = POLICY_TEMPLATE_CONFIDENTIAL_APPROVAL_REQUIRED


def seed_defaults(db: Session) -> None:
    providers = [
        {"name": "openai", "type": "api"},
        {"name": "anthropic", "type": "api"},
        {"name": "gemini", "type": "api"},
        {"name": "perplexity", "type": "saas"},
    ]
    for provider in providers:
        exists = db.query(AIProvider).filter(AIProvider.name == provider["name"]).first()
        if not exists:
            db.add(AIProvider(**provider))

    tools = [
        {
            "name": "send_email",
            "base_url": f"{settings.MOCK_TOOLS_BASE_URL}/mock/send_email",
            "method": "POST",
            "risk_level": "high",
        },
        {
            "name": "external_post",
            "base_url": f"{settings.MOCK_TOOLS_BASE_URL}/mock/external_post",
            "method": "POST",
            "risk_level": "high",
        },
        {
            "name": "read_db",
            "base_url": f"{settings.MOCK_TOOLS_BASE_URL}/mock/read_db",
            "method": "POST",
            "risk_level": "low",
        },
    ]

    for spec in tools:
        exists = db.query(Tool).filter(Tool.name == spec["name"]).first()
        if not exists:
            db.add(Tool(**spec))

    active_policy = db.query(Policy).filter(Policy.is_active.is_(True)).first()
    if not active_policy:
        db.query(Policy).update({Policy.is_active: False})
        db.add(
            Policy(
                name="Default Security Policy v1",
                version=1,
                yaml_text=DEFAULT_POLICY_YAML,
                is_active=True,
            )
        )

    admin = db.query(User).filter(User.email == "admin@example.com").first()
    if not admin:
        db.add(
            User(
                email="admin@example.com",
                password_hash=get_password_hash("Admin123!"),
                role="Admin",
            )
        )

    demo_agent = db.query(Agent).filter(Agent.name == "demo-public-agent").first()
    if not demo_agent:
        db.add(
            Agent(
                name="demo-public-agent",
                owner_email="owner@example.com",
                data_classification="Public",
                status="active",
                api_key_hash=hash_api_key("demo-public-agent-key"),
            )
        )

    assumption = db.query(LossAssumption).filter(LossAssumption.organization_id == "org").first()
    if not assumption:
        db.add(
            LossAssumption(
                organization_id="org",
                assumed_incident_cost_usd=25000,
                confidence=0.35,
                high_risk_threshold=70,
                enabled=True,
            )
        )

    db.commit()
