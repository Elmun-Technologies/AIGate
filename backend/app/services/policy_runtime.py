from typing import Any

import requests

from app.core.config import settings
from app.services.policy_engine import evaluate_policy


def evaluate_policy_runtime(yaml_text: str, context: dict[str, Any]) -> tuple[str, str, str, str]:
    """
    Runtime policy evaluator:
      1) OPA (if configured and reachable)
      2) YAML policy engine fallback
    Returns: decision, reason, rule, source
    """
    if settings.OPA_URL:
        try:
            response = requests.post(
                f"{settings.OPA_URL.rstrip('/')}/v1/data/agentgate/decision",
                json={"input": context},
                timeout=2.5,
            )
            if response.ok:
                payload = response.json().get("result") or {}
                decision = str(payload.get("decision", "")).upper()
                if decision in {"ALLOW", "BLOCK", "REQUIRE_APPROVAL"}:
                    reason = str(payload.get("reason", "OPA decision"))
                    rule = str(payload.get("rule", "opa-rule"))
                    return decision, reason, rule, "opa"
        except Exception:
            pass

    decision, reason, rule = evaluate_policy(yaml_text, context)
    return decision, reason, rule, "yaml"
