from __future__ import annotations

import textwrap

POLICY_TEMPLATE_PII_OUTBOUND_BLOCK = textwrap.dedent(
    """\
    version: 1
    rules:
      - name: "Block prompt injection signatures"
        if:
          prompt_contains_any:
            - "ignore previous instructions"
            - "system prompt"
            - "exfiltrate"
            - "bypass"
        then:
          decision: "BLOCK"
          reason: "Prompt injection pattern"

      - name: "Block outbound PII payloads"
        if:
          and:
            - tool_in: ["external_post"]
            - payload_contains_pii: true
        then:
          decision: "BLOCK"
          reason: "PII outbound payload blocked"

      - name: "Require approval for outbound external_post"
        if:
          tool_in: ["external_post"]
        then:
          decision: "REQUIRE_APPROVAL"
          reason: "Outbound post requires security review"

      - name: "Safe default"
        then:
          decision: "REQUIRE_APPROVAL"
          reason: "Safe default posture"
    """
)

POLICY_TEMPLATE_CONFIDENTIAL_APPROVAL_REQUIRED = textwrap.dedent(
    """\
    version: 1
    rules:
      - name: "Block prompt injection signatures"
        if:
          prompt_contains_any:
            - "ignore previous instructions"
            - "system prompt"
            - "exfiltrate"
            - "bypass"
        then:
          decision: "BLOCK"
          reason: "Prompt injection pattern"

      - name: "Confidential outbound requires approval"
        if:
          and:
            - agent_data_classification_in: ["Confidential", "PII"]
            - tool_in: ["external_post", "send_email"]
        then:
          decision: "REQUIRE_APPROVAL"
          reason: "Confidential data path requires approver"

      - name: "External post requires approval"
        if:
          tool_in: ["external_post"]
        then:
          decision: "REQUIRE_APPROVAL"
          reason: "High-risk egress channel"

      - name: "Safe default"
        then:
          decision: "REQUIRE_APPROVAL"
          reason: "Safe default posture"
    """
)

POLICY_TEMPLATE_BUDGET_CAP = textwrap.dedent(
    """\
    version: 1
    rules:
      - name: "Block prompt injection signatures"
        if:
          prompt_contains_any:
            - "ignore previous instructions"
            - "system prompt"
            - "exfiltrate"
            - "bypass"
        then:
          decision: "BLOCK"
          reason: "Prompt injection pattern"

      - name: "Daily spend cap hard block"
        if:
          spend_agent_day_usd_gte: 50
        then:
          decision: "BLOCK"
          reason: "Agent daily spend cap exceeded"

      - name: "Daily spend warning approval"
        if:
          spend_agent_day_usd_gte: 25
        then:
          decision: "REQUIRE_APPROVAL"
          reason: "Agent daily spend threshold reached"

      - name: "High risk tools require approval"
        if:
          tool_in: ["external_post", "send_email"]
        then:
          decision: "REQUIRE_APPROVAL"
          reason: "High risk tool"

      - name: "Safe default"
        then:
          decision: "REQUIRE_APPROVAL"
          reason: "Safe default posture"
    """
)

POLICY_TEMPLATE_DESTINATION_ALLOWLIST = textwrap.dedent(
    """\
    version: 1
    rules:
      - name: "Block prompt injection signatures"
        if:
          prompt_contains_any:
            - "ignore previous instructions"
            - "system prompt"
            - "exfiltrate"
            - "bypass"
        then:
          decision: "BLOCK"
          reason: "Prompt injection pattern"

      - name: "Block unknown external destinations"
        if:
          and:
            - tool_in: ["external_post"]
            - destination_allowlisted: false
        then:
          decision: "BLOCK"
          reason: "Destination domain is not allowlisted"

      - name: "Allow allowlisted destinations"
        if:
          and:
            - tool_in: ["external_post"]
            - destination_allowlisted: true
        then:
          decision: "REQUIRE_APPROVAL"
          reason: "Allowlisted destination requires approval"

      - name: "Safe default"
        then:
          decision: "REQUIRE_APPROVAL"
          reason: "Safe default posture"
    """
)


POLICY_TEMPLATES = {
    "PII_OUTBOUND_BLOCK": {
        "key": "PII_OUTBOUND_BLOCK",
        "name": "PII Outbound Block",
        "description": "Blocks outbound external_post calls when payload contains PII; otherwise requires approval.",
        "yaml_text": POLICY_TEMPLATE_PII_OUTBOUND_BLOCK,
    },
    "CONFIDENTIAL_APPROVAL_REQUIRED": {
        "key": "CONFIDENTIAL_APPROVAL_REQUIRED",
        "name": "Confidential Approval Required",
        "description": "Confidential/PII agent egress requires human approval.",
        "yaml_text": POLICY_TEMPLATE_CONFIDENTIAL_APPROVAL_REQUIRED,
    },
    "BUDGET_CAP": {
        "key": "BUDGET_CAP",
        "name": "Budget Cap",
        "description": "Requires approval or blocks when per-agent daily spend crosses thresholds.",
        "yaml_text": POLICY_TEMPLATE_BUDGET_CAP,
    },
    "DESTINATION_ALLOWLIST": {
        "key": "DESTINATION_ALLOWLIST",
        "name": "Destination Allowlist",
        "description": "Blocks unknown outbound domains and gates allowlisted destinations behind approval.",
        "yaml_text": POLICY_TEMPLATE_DESTINATION_ALLOWLIST,
    },
}


def list_policy_templates() -> list[dict]:
    return [POLICY_TEMPLATES[key] for key in sorted(POLICY_TEMPLATES.keys())]


def get_policy_template(template_key: str) -> dict | None:
    if not template_key:
        return None
    return POLICY_TEMPLATES.get(template_key.strip().upper())
