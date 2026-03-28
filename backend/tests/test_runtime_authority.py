from types import SimpleNamespace

from app.services.runtime_authority import attach_runtime_authority, issue_runtime_token, verify_runtime_token


def _tool_call_stub():
    return SimpleNamespace(
        id="tool-call-1",
        agent_id="agent-1",
        runtime_nonce=None,
        runtime_auth_hash=None,
        runtime_issued_at=None,
        runtime_expires_at=None,
        authorization_mode=None,
    )


def test_runtime_token_issue_and_verify():
    stub = _tool_call_stub()
    token, payload = issue_runtime_token(
        tool_call_id="tool-call-1",
        agent_id="agent-1",
        tool_name="external_post",
        nonce="nonce-1",
        ttl_seconds=300,
    )
    attach_runtime_authority(stub, token=token, payload=payload)
    valid, reason = verify_runtime_token(stub, token=token, expected_tool="external_post")
    assert valid is True
    assert reason == "ok"


def test_runtime_token_scope_mismatch():
    stub = _tool_call_stub()
    token, payload = issue_runtime_token(
        tool_call_id="tool-call-1",
        agent_id="agent-1",
        tool_name="read_db",
        nonce="nonce-1",
        ttl_seconds=300,
    )
    attach_runtime_authority(stub, token=token, payload=payload)
    valid, reason = verify_runtime_token(stub, token=token, expected_tool="send_email")
    assert valid is False
    assert reason == "runtime_scope_tool_mismatch"
