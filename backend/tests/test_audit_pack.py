from types import SimpleNamespace

from app.services.audit_pack import build_audit_pack


def _tool_call(id_: str, session_id: str):
    return SimpleNamespace(
        id=id_,
        agent_id="agent-1",
        tool_id="tool-1",
        status="blocked",
        risk_score=85,
        decision_reason="Blocked",
        request_json_redacted={"session_id": session_id, "tool": "external_post"},
        response_json_redacted=None,
        created_at=None,
    )


def _audit_event(id_: str, tool_call_id: str):
    return SimpleNamespace(
        id=id_,
        stream_id="agent-1",
        event_type="TOOL_CALL_EVALUATED",
        decision="BLOCK",
        risk_score=85,
        prev_hash=None,
        chain_hash=f"hash-{id_}",
        payload_redacted_json={"tool_call_id": tool_call_id},
        created_at=None,
    )


def _approval(id_: str, tool_call_id: str):
    return SimpleNamespace(
        id=id_,
        tool_call_id=tool_call_id,
        status="pending",
        approver_user_id=None,
        reason=None,
        created_at=None,
        resolved_at=None,
    )


def test_build_audit_pack_filters_by_session():
    pack = build_audit_pack(
        session_id="session-a",
        tool_calls=[_tool_call("tc-a", "session-a"), _tool_call("tc-b", "session-b")],
        audit_events=[_audit_event("ae-a", "tc-a"), _audit_event("ae-b", "tc-b")],
        approvals=[_approval("ap-a", "tc-a"), _approval("ap-b", "tc-b")],
        active_policy=None,
    )
    assert pack["session_id"] == "session-a"
    assert len(pack["tool_calls"]) == 1
    assert pack["tool_calls"][0]["id"] == "tc-a"
    assert len(pack["audit_events"]) == 1
    assert pack["audit_events"][0]["id"] == "ae-a"
    assert len(pack["approvals"]) == 1
    assert pack["approvals"][0]["id"] == "ap-a"
