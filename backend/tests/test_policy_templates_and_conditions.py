from app.services.policy_engine import evaluate_policy
from app.services.policy_templates import get_policy_template, list_policy_templates


def test_policy_templates_exist():
    templates = list_policy_templates()
    keys = {row["key"] for row in templates}
    assert "PII_OUTBOUND_BLOCK" in keys
    assert "CONFIDENTIAL_APPROVAL_REQUIRED" in keys
    assert "BUDGET_CAP" in keys
    assert "DESTINATION_ALLOWLIST" in keys
    assert get_policy_template("pii_outbound_block") is not None


def test_extended_conditions_match_expected():
    policy = """version: 1
rules:
  - name: "Block PII outbound"
    if:
      and:
        - tool_in: ["external_post"]
        - payload_contains_pii: true
    then:
      decision: "BLOCK"
      reason: "PII blocked"
  - name: "Allowlisted destination"
    if:
      and:
        - tool_in: ["external_post"]
        - destination_allowlisted: true
    then:
      decision: "REQUIRE_APPROVAL"
      reason: "Allowlisted requires approval"
"""
    decision, reason, rule = evaluate_policy(
        policy,
        {
            "tool": "external_post",
            "payload_contains_pii": True,
            "destination_allowlisted": False,
            "risk_score": 90,
        },
    )
    assert decision == "BLOCK"
    assert reason == "PII blocked"
    assert rule == "Block PII outbound"


def test_safe_default_is_not_allow():
    decision, reason, rule = evaluate_policy("version: 1\nrules: []\n", {"tool": "read_db"})
    assert decision == "REQUIRE_APPROVAL"
    assert "No explicit allow" in reason
    assert rule == "default-require-approval"
