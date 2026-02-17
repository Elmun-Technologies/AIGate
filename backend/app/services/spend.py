import json
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from app.models.tool_call import ToolCall


DEFAULT_PROVIDER = "openai"
DEFAULT_MODEL = "gpt-4.1-mini"
TOKEN_PRICE_USD = Decimal("0.000002")


def _estimate_tokens_from_value(value: Any) -> int:
    if value is None:
        return 0
    if isinstance(value, str):
        text = value
    else:
        text = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if not text:
        return 0
    return max(1, int(len(text) / 4))


def estimate_cost_usd(tokens_in: int | None, tokens_out: int | None) -> Decimal:
    safe_in = max(0, int(tokens_in or 0))
    safe_out = max(0, int(tokens_out or 0))
    total_tokens = safe_in + safe_out
    usd = Decimal(total_tokens) * TOKEN_PRICE_USD
    return usd.quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)


def apply_spend_on_create(tool_call: ToolCall, prompt: str, args: dict[str, Any]) -> None:
    tokens_in = _estimate_tokens_from_value(prompt) + _estimate_tokens_from_value(args)
    tool_call.provider = DEFAULT_PROVIDER
    tool_call.model = DEFAULT_MODEL
    tool_call.tokens_in = tokens_in
    tool_call.tokens_out = 0
    tool_call.cost_usd = estimate_cost_usd(tokens_in, 0)
    tool_call.cost_source = "estimated"


def apply_spend_on_execute(tool_call: ToolCall, prompt: str, args: dict[str, Any], response: Any) -> None:
    # Preserve initial estimate when present so approvals/blocked calls still retain baseline spend.
    tokens_in = tool_call.tokens_in if tool_call.tokens_in is not None else _estimate_tokens_from_value(prompt) + _estimate_tokens_from_value(args)
    tokens_out = _estimate_tokens_from_value(response)
    tool_call.provider = tool_call.provider or DEFAULT_PROVIDER
    tool_call.model = tool_call.model or DEFAULT_MODEL
    tool_call.tokens_in = tokens_in
    tool_call.tokens_out = tokens_out
    tool_call.cost_usd = estimate_cost_usd(tokens_in, tokens_out)
    tool_call.cost_source = "estimated"
