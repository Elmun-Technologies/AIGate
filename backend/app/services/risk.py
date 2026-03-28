from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlparse


EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
PHONE_RE = re.compile(r"\b(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b")
CARD_RE = re.compile(r"\b(?:\d[ -]*?){13,19}\b")

INJECTION_PATTERNS = [
    "ignore previous instructions",
    "system prompt",
    "exfiltrate",
    "bypass",
]

CREDENTIAL_PATTERNS = [
    (re.compile(r"AKIA[A-Z0-9]{16}"), "AWS Access Key"),
    (re.compile(r"AKIA[A-Z0-9_]{4,}"), "AWS Access Key"),
    (re.compile(r"(?i)aws_secret_access_key\s*[=:]\s*[\w/+/]{40}"), "AWS Secret Key"),
    (re.compile(r"(?i)bearer\s+[A-Za-z0-9\-_\.]+"), "API Token"),
    (re.compile(r"(?i)api[_-]?key\s*[=:]\s*[\w-]{20,}"), "API Key"),
    (re.compile(r"-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----"), "Private Key"),
]

CLASSIFICATION_WEIGHTS = {
    "public": 0,
    "internal": 10,
    "confidential": 25,
    "pii": 40,
}

TOOL_WEIGHTS = {
    "read_db": 10,
    "send_email": 35,
    "external_post": 45,
}


def clamp_score(value: int) -> int:
    return max(0, min(100, int(value)))


def prompt_has_injection(prompt: str) -> bool:
    prompt_lower = (prompt or "").lower()
    return any(pattern in prompt_lower for pattern in INJECTION_PATTERNS)


def detect_credentials(prompt: str) -> list[str]:
    detected = []
    prompt_text = prompt or ""
    for pattern, name in CREDENTIAL_PATTERNS:
        if pattern.search(prompt_text):
            detected.append(name)
    return detected


def payload_contains_pii(value: Any) -> bool:
    text = str(value or "")
    return bool(EMAIL_RE.search(text) or PHONE_RE.search(text) or CARD_RE.search(text))


def extract_destination_domain(args: dict[str, Any]) -> str:
    raw = str((args or {}).get("url") or "").strip()
    if not raw:
        return ""
    parsed = urlparse(raw)
    return (parsed.hostname or "").lower()


def _factor(name: str, contribution: int, explanation: str) -> dict[str, Any]:
    return {
        "name": name,
        "contribution": int(contribution),
        "explanation": explanation,
    }


def calculate_risk_with_breakdown(
    *,
    tool_name: str,
    tool_risk_level: str,
    prompt: str,
    args: dict[str, Any],
    agent_classification: str,
    destination_allowlist: set[str] | None,
    spend_spike: bool,
    owner_missing: bool,
) -> dict[str, Any]:
    factors: list[dict[str, Any]] = []

    normalized_classification = str(agent_classification or "public").lower()
    classification_points = CLASSIFICATION_WEIGHTS.get(normalized_classification, 0)
    factors.append(
        _factor(
            "data_classification",
            classification_points,
            f"classification={agent_classification or 'Public'}",
        )
    )

    normalized_tool = str(tool_name or "").lower()
    tool_points = TOOL_WEIGHTS.get(normalized_tool, 10)
    factors.append(_factor("tool_type", tool_points, f"tool={tool_name or 'unknown'}"))

    destination_domain = extract_destination_domain(args or {})
    allowlist = {item.strip().lower() for item in (destination_allowlist or set()) if item.strip()}
    if destination_domain:
        if allowlist and destination_domain in allowlist:
            factors.append(
                _factor(
                    "destination",
                    -10,
                    f"destination={destination_domain} is allowlisted",
                )
            )
        else:
            factors.append(
                _factor(
                    "destination",
                    20,
                    f"destination={destination_domain} is unknown/not allowlisted",
                )
            )
    else:
        factors.append(_factor("destination", 0, "no external destination"))

    if spend_spike:
        factors.append(_factor("anomaly", 15, "usage frequency spike vs baseline"))
    else:
        factors.append(_factor("anomaly", 0, "no frequency anomaly"))

    if owner_missing:
        factors.append(_factor("auth_context", 10, "agent owner context missing"))
    else:
        factors.append(_factor("auth_context", 0, "owner context present"))

    if prompt_has_injection(prompt):
        factors.append(_factor("prompt_injection_signal", 20, "prompt contains known injection pattern"))
    else:
        factors.append(_factor("prompt_injection_signal", 0, "no injection pattern"))

    detected_creds = detect_credentials(prompt)
    if detected_creds:
        factors.append(_factor("credential_leak_signal", 50, f"prompt contains: {', '.join(detected_creds)}"))
    else:
        factors.append(_factor("credential_leak_signal", 0, "no credentials detected"))

    if payload_contains_pii(args):
        factors.append(_factor("payload_pii_signal", 25, "payload appears to contain PII"))
    else:
        factors.append(_factor("payload_pii_signal", 0, "no obvious PII in payload"))

    base_score = sum(item["contribution"] for item in factors)
    score = clamp_score(base_score)
    return {
        "score": score,
        "factors": factors,
        "destination_domain": destination_domain or None,
        "payload_contains_pii": payload_contains_pii(args),
        "prompt_has_injection": prompt_has_injection(prompt),
        "tool_risk_level": tool_risk_level,
        "detected_credentials": detected_creds,
    }


def calculate_risk(tool_risk_level: str, prompt: str, agent_classification: str) -> int:
    # Backward-compatible wrapper used in older paths.
    info = calculate_risk_with_breakdown(
        tool_name="unknown",
        tool_risk_level=tool_risk_level,
        prompt=prompt,
        args={},
        agent_classification=agent_classification,
        destination_allowlist=set(),
        spend_spike=False,
        owner_missing=False,
    )
    return info["score"]

