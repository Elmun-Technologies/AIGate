RISK_BASE = {
    "low": 10,
    "medium": 40,
    "high": 70,
}

INJECTION_PATTERNS = [
    "ignore previous instructions",
    "system prompt",
    "exfiltrate",
    "bypass",
]


def prompt_has_injection(prompt: str) -> bool:
    prompt_lower = prompt.lower()
    return any(pattern in prompt_lower for pattern in INJECTION_PATTERNS)


def calculate_risk(tool_risk_level: str, prompt: str, agent_classification: str) -> int:
    score = RISK_BASE.get(tool_risk_level.lower(), 10)
    if prompt_has_injection(prompt):
        score += 20
    if agent_classification in {"PII", "Confidential"}:
        score += 15
    return min(100, max(0, score))
