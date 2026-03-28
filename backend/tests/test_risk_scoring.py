from app.services.risk import calculate_risk_with_breakdown


def test_risk_scoring_is_deterministic():
    kwargs = {
        "tool_name": "external_post",
        "tool_risk_level": "high",
        "prompt": "Please send a report",
        "args": {"url": "https://unknown-vendor.example/ingest", "payload": {"email": "alice@example.com"}},
        "agent_classification": "Confidential",
        "destination_allowlist": {"api.partner.example"},
        "spend_spike": True,
        "owner_missing": False,
    }
    first = calculate_risk_with_breakdown(**kwargs)
    second = calculate_risk_with_breakdown(**kwargs)
    assert first["score"] == second["score"]
    assert first["factors"] == second["factors"]
    assert first["payload_contains_pii"] is True
    assert first["destination_domain"] == "unknown-vendor.example"


def test_risk_scoring_respects_allowlist_offset():
    allowlisted = calculate_risk_with_breakdown(
        tool_name="external_post",
        tool_risk_level="high",
        prompt="send telemetry",
        args={"url": "https://api.partner.example/ingest"},
        agent_classification="Public",
        destination_allowlist={"api.partner.example"},
        spend_spike=False,
        owner_missing=False,
    )
    unknown = calculate_risk_with_breakdown(
        tool_name="external_post",
        tool_risk_level="high",
        prompt="send telemetry",
        args={"url": "https://unknown.example/ingest"},
        agent_classification="Public",
        destination_allowlist={"api.partner.example"},
        spend_spike=False,
        owner_missing=False,
    )
    assert int(allowlisted["score"]) < int(unknown["score"])
