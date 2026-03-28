import base64
import hashlib
import hmac
import json
from datetime import datetime, timedelta, timezone
from typing import Any

from app.core.config import settings
from app.models.tool_call import ToolCall


def _b64_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("utf-8")


def _b64_decode(value: str) -> bytes:
    pad = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode((value + pad).encode("utf-8"))


def _canonical_json(payload: dict[str, Any]) -> str:
    return json.dumps(payload, separators=(",", ":"), sort_keys=True, ensure_ascii=True, default=str)


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def issue_runtime_token(*, tool_call_id: str, agent_id: str, tool_name: str, nonce: str, ttl_seconds: int) -> tuple[str, dict[str, Any]]:
    header = {"alg": "HS256", "typ": "AGRT"}
    issued_at = datetime.now(timezone.utc)
    payload = {
        "tool_call_id": tool_call_id,
        "agent_id": agent_id,
        "tool": tool_name,
        "nonce": nonce,
        "iat": int(issued_at.timestamp()),
        "exp": int((issued_at + timedelta(seconds=max(1, ttl_seconds))).timestamp()),
        "authority": "agentgate",
    }
    encoded_header = _b64_encode(_canonical_json(header).encode("utf-8"))
    encoded_payload = _b64_encode(_canonical_json(payload).encode("utf-8"))
    digest = hmac.new(
        settings.SECRET_KEY.encode("utf-8"),
        f"{encoded_header}.{encoded_payload}".encode("utf-8"),
        hashlib.sha256,
    ).digest()
    signature = _b64_encode(digest)
    return f"{encoded_header}.{encoded_payload}.{signature}", payload


def attach_runtime_authority(tool_call: ToolCall, *, token: str, payload: dict[str, Any]) -> None:
    tool_call.runtime_nonce = str(payload.get("nonce") or "")
    tool_call.runtime_auth_hash = _token_hash(token)
    issued_at = datetime.fromtimestamp(int(payload["iat"]), tz=timezone.utc)
    expires_at = datetime.fromtimestamp(int(payload["exp"]), tz=timezone.utc)
    tool_call.runtime_issued_at = issued_at
    tool_call.runtime_expires_at = expires_at
    tool_call.authorization_mode = "runtime_token"


def verify_runtime_token(
    tool_call: ToolCall,
    *,
    token: str,
    expected_tool: str,
) -> tuple[bool, str]:
    if not token:
        return False, "missing_runtime_token"
    if not tool_call.runtime_auth_hash:
        return False, "runtime_authority_missing"
    if _token_hash(token) != tool_call.runtime_auth_hash:
        return False, "runtime_hash_mismatch"

    try:
        encoded_header, encoded_payload, encoded_signature = token.split(".")
    except ValueError:
        return False, "runtime_malformed"

    expected_signature = hmac.new(
        settings.SECRET_KEY.encode("utf-8"),
        f"{encoded_header}.{encoded_payload}".encode("utf-8"),
        hashlib.sha256,
    ).digest()
    if not hmac.compare_digest(expected_signature, _b64_decode(encoded_signature)):
        return False, "runtime_bad_signature"

    try:
        payload = json.loads(_b64_decode(encoded_payload))
    except Exception:
        return False, "runtime_payload_invalid"

    now_ts = int(datetime.now(timezone.utc).timestamp())
    if int(payload.get("exp", 0)) < now_ts:
        return False, "runtime_expired"
    if str(payload.get("tool_call_id")) != str(tool_call.id):
        return False, "runtime_scope_tool_call_mismatch"
    if str(payload.get("agent_id")) != str(tool_call.agent_id):
        return False, "runtime_scope_agent_mismatch"
    if str(payload.get("tool")) != expected_tool:
        return False, "runtime_scope_tool_mismatch"
    if tool_call.runtime_expires_at and tool_call.runtime_expires_at < datetime.now(timezone.utc):
        return False, "runtime_expired_db"
    return True, "ok"
