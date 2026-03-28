from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.policy_suggestion import PolicySuggestion
from app.models.tool import Tool
from app.models.tool_call import ToolCall


def _default_suggestion_yaml(tool_name: str, min_risk: int) -> str:
    return f"""version: 1
rules:
  - name: "Auto harden {tool_name}"
    if:
      and:
        - tool_in: ["{tool_name}"]
        - risk_score_gte: {min_risk}
    then:
      decision: "REQUIRE_APPROVAL"
      reason: "Auto-generated guardrail from observed risky usage"

  - name: "Default allow"
    then:
      decision: "ALLOW"
      reason: "Default"
"""


def refresh_policy_suggestions(db: Session, lookback_days: int = 14) -> list[PolicySuggestion]:
    cutoff = datetime.now(timezone.utc) - timedelta(days=max(1, lookback_days))
    risky_rows = (
        db.query(
            Tool.name.label("tool_name"),
            func.count(ToolCall.id).label("events"),
            func.coalesce(func.avg(ToolCall.risk_score), 0).label("avg_risk"),
        )
        .join(Tool, Tool.id == ToolCall.tool_id)
        .filter(
            ToolCall.created_at >= cutoff,
            ToolCall.status.in_(["blocked", "pending", "allowed"]),
            ToolCall.risk_score >= 60,
        )
        .group_by(Tool.name)
        .order_by(func.count(ToolCall.id).desc())
        .limit(6)
        .all()
    )

    created_or_updated: list[PolicySuggestion] = []
    for row in risky_rows:
        tool_name = str(row.tool_name)
        events = int(row.events or 0)
        avg_risk = float(row.avg_risk or 0)
        min_risk = max(60, int(avg_risk))
        title = f"Require approval for risky {tool_name}"
        description = (
            f"Observed {events} risky calls for `{tool_name}` in the last {lookback_days} days. "
            f"Average risk score: {avg_risk:.1f}."
        )
        suggested_yaml = _default_suggestion_yaml(tool_name, min_risk=min_risk)
        confidence = Decimal("0.60") if events < 5 else Decimal("0.82")
        existing = (
            db.query(PolicySuggestion)
            .filter(
                PolicySuggestion.title == title,
                PolicySuggestion.status.in_(["open", "applied"]),
            )
            .first()
        )
        if not existing:
            existing = PolicySuggestion(
                title=title,
                description=description,
                suggested_yaml=suggested_yaml,
                confidence_score=confidence,
                source_metrics={
                    "tool": tool_name,
                    "events": events,
                    "avg_risk": round(avg_risk, 2),
                    "lookback_days": lookback_days,
                },
                status="open",
            )
            db.add(existing)
        else:
            existing.description = description
            existing.suggested_yaml = suggested_yaml
            existing.confidence_score = confidence
            existing.source_metrics = {
                "tool": tool_name,
                "events": events,
                "avg_risk": round(avg_risk, 2),
                "lookback_days": lookback_days,
            }
        created_or_updated.append(existing)

    db.flush()
    return created_or_updated
