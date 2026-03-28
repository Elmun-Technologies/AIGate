from typing import Any

import yaml


def _ensure_list(value: Any) -> list:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def _match_atomic(condition: dict[str, Any], context: dict[str, Any]) -> bool:
    ok = True
    if "tool_in" in condition:
        tools = [str(x) for x in _ensure_list(condition["tool_in"])]
        ok = ok and context.get("tool") in tools
    if "prompt_contains_any" in condition:
        prompt = str(context.get("prompt", "")).lower()
        needles = [str(x).lower() for x in _ensure_list(condition["prompt_contains_any"])]
        ok = ok and any(needle in prompt for needle in needles)
    if "agent_data_classification_in" in condition:
        allowed = [str(x) for x in _ensure_list(condition["agent_data_classification_in"])]
        ok = ok and context.get("agent_data_classification") in allowed
    if "risk_score_gte" in condition:
        ok = ok and int(context.get("risk_score", 0)) >= int(condition["risk_score_gte"])
    if "payload_contains_pii" in condition:
        ok = ok and bool(context.get("payload_contains_pii")) is bool(condition["payload_contains_pii"])
    if "destination_domain_in" in condition:
        allowed_domains = [str(x).lower() for x in _ensure_list(condition["destination_domain_in"])]
        destination = str(context.get("destination_domain", "")).lower()
        ok = ok and destination in allowed_domains
    if "destination_domain_not_in" in condition:
        denied_domains = [str(x).lower() for x in _ensure_list(condition["destination_domain_not_in"])]
        destination = str(context.get("destination_domain", "")).lower()
        ok = ok and destination not in denied_domains
    if "destination_allowlisted" in condition:
        ok = ok and bool(context.get("destination_allowlisted")) is bool(condition["destination_allowlisted"])
    if "spend_agent_day_usd_gte" in condition:
        ok = ok and float(context.get("spend_agent_day_usd", 0.0)) >= float(condition["spend_agent_day_usd_gte"])
    if "owner_missing" in condition:
        ok = ok and bool(context.get("owner_missing")) is bool(condition["owner_missing"])
    return ok


def matches_condition(condition: dict[str, Any] | None, context: dict[str, Any]) -> bool:
    if not condition:
        return True
    if not isinstance(condition, dict):
        return False

    base_ok = _match_atomic(condition, context)

    and_ok = True
    if "and" in condition:
        and_ok = all(matches_condition(item, context) for item in _ensure_list(condition["and"]))

    or_ok = True
    if "or" in condition:
        or_ok = any(matches_condition(item, context) for item in _ensure_list(condition["or"]))

    return base_ok and and_ok and or_ok


def evaluate_policy(yaml_text: str, context: dict[str, Any]) -> tuple[str, str, str]:
    try:
        loaded = yaml.safe_load(yaml_text) or {}
    except yaml.YAMLError as exc:
        raise ValueError(f"Invalid policy YAML: {exc}") from exc

    rules = loaded.get("rules", [])
    if not isinstance(rules, list):
        raise ValueError("Policy YAML must contain a list under 'rules'")

    for rule in rules:
        if not isinstance(rule, dict):
            continue
        condition = rule.get("if")
        if matches_condition(condition, context):
            then = rule.get("then", {})
            decision = str(then.get("decision", "ALLOW")).upper()
            reason = str(then.get("reason", "Matched policy"))
            name = str(rule.get("name", "unnamed-rule"))
            return decision, reason, name

    return "REQUIRE_APPROVAL", "No explicit allow rule matched", "default-require-approval"
