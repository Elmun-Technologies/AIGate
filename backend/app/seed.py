from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import get_password_hash, hash_api_key
from app.models.agent import Agent
from app.models.policy import Policy
from app.models.tool import Tool
from app.models.user import User

DEFAULT_POLICY_YAML = """version: 1
rules:
  - name: "Block known injection patterns"
    if:
      prompt_contains_any:
        - "ignore previous instructions"
        - "system prompt"
        - "exfiltrate"
        - "bypass"
    then:
      decision: "BLOCK"
      reason: "Prompt injection pattern"

  - name: "Confidential data cannot leave"
    if:
      and:
        - agent_data_classification_in: ["Confidential", "PII"]
        - tool_in: ["external_post"]
    then:
      decision: "BLOCK"
      reason: "Data exfiltration risk"

  - name: "High risk tools require approval"
    if:
      tool_in: ["send_email", "external_post"]
    then:
      decision: "REQUIRE_APPROVAL"
      reason: "High risk tool"

  - name: "Default allow"
    then:
      decision: "ALLOW"
      reason: "Default"
"""


def seed_defaults(db: Session) -> None:
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
                name="Default Security Policy",
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

    db.commit()
