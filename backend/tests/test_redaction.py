from app.services.redaction import redact_data, redact_text


def test_redact_text_patterns():
    raw = "Contact alice@example.com or +1 202-555-0123. Card 4111 1111 1111 1111."
    redacted = redact_text(raw)
    assert "[REDACTED_EMAIL]" in redacted
    assert "[REDACTED_PHONE]" in redacted
    assert "[REDACTED_CARD]" in redacted


def test_redact_sensitive_block():
    raw = "safe [SENSITIVE]secret payload[/SENSITIVE] tail"
    redacted = redact_text(raw)
    assert "[REDACTED_SENSITIVE]" in redacted
    assert "secret payload" not in redacted


def test_redact_nested_data():
    payload = {"email": "alice@example.com", "nested": {"phone": "+1 202-555-0123"}}
    redacted = redact_data(payload)
    assert redacted["email"] == "[REDACTED_EMAIL]"
    assert redacted["nested"]["phone"] == "[REDACTED_PHONE]"
