import re
from typing import Any

EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
PHONE_RE = re.compile(r"(?<!\w)(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}(?!\w)")
CARD_RE = re.compile(r"\b(?:\d[ -]*?){13,19}\b")
SENSITIVE_BLOCK_RE = re.compile(r"\[SENSITIVE\].*?\[/SENSITIVE\]", re.IGNORECASE | re.DOTALL)


def redact_text(text: str) -> str:
    value = SENSITIVE_BLOCK_RE.sub("[REDACTED_SENSITIVE]", text)
    value = EMAIL_RE.sub("[REDACTED_EMAIL]", value)
    value = PHONE_RE.sub("[REDACTED_PHONE]", value)
    value = CARD_RE.sub("[REDACTED_CARD]", value)
    return value


def redact_data(data: Any) -> Any:
    if isinstance(data, dict):
        return {k: redact_data(v) for k, v in data.items()}
    if isinstance(data, list):
        return [redact_data(item) for item in data]
    if isinstance(data, str):
        return redact_text(data)
    return data
