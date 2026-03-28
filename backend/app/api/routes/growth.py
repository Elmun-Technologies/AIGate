from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_roles
from app.models.agent import Agent
from app.models.api_key import APIKey
from app.models.approval_request import ApprovalRequest
from app.models.beta_signup import BetaSignup
from app.models.tool_call import ToolCall
from app.schemas.growth import BetaOnboardRequest, BetaOnboardResponse
from app.services.growth_integrations import ensure_stripe_customer, track_mixpanel_event

router = APIRouter(prefix="/growth", tags=["growth"])


@router.post("/beta-onboard", response_model=BetaOnboardResponse)
def beta_onboard(
    payload: BetaOnboardRequest,
    db: Session = Depends(get_db),
    _=Depends(require_roles("Admin", "Security")),
) -> BetaSignup:
    signup = BetaSignup(
        company_name=payload.company_name.strip(),
        contact_email=payload.contact_email.strip().lower(),
        team_size=payload.team_size,
        use_case=payload.use_case.strip(),
        notes=(payload.notes or "").strip() or None,
        status="new",
    )
    db.add(signup)
    db.commit()
    db.refresh(signup)

    track_mixpanel_event(
        "beta_onboarded",
        {
            "distinct_id": signup.contact_email,
            "company_name": signup.company_name,
            "team_size": signup.team_size or 0,
        },
    )
    stripe_customer = ensure_stripe_customer(
        email=signup.contact_email,
        name=signup.company_name,
        metadata={"beta_signup_id": str(signup.id)},
    )
    if stripe_customer:
        signup.notes = ((signup.notes + "\n") if signup.notes else "") + f"stripe_customer={stripe_customer}"
        db.commit()
    return signup


@router.get("/metrics")
def growth_metrics(
    db: Session = Depends(get_db),
    _=Depends(require_roles("Admin", "Security", "Auditor")),
) -> dict:
    now = datetime.now(timezone.utc)
    since_30d = now - timedelta(days=30)
    signups_30d = db.query(func.count(BetaSignup.id)).filter(BetaSignup.created_at >= since_30d).scalar() or 0
    total_signups = db.query(func.count(BetaSignup.id)).scalar() or 0
    active_agents = db.query(func.count(Agent.id)).filter(Agent.status == "active").scalar() or 0
    calls_30d = db.query(func.count(ToolCall.id)).filter(ToolCall.created_at >= since_30d).scalar() or 0
    blocked_high_risk_30d = (
        db.query(func.count(ToolCall.id))
        .filter(ToolCall.created_at >= since_30d, ToolCall.status == "blocked", ToolCall.risk_score >= 70)
        .scalar()
        or 0
    )
    pending_approvals = (
        db.query(func.count(ApprovalRequest.id))
        .filter(ApprovalRequest.status == "pending")
        .scalar()
        or 0
    )
    shadow_keys = db.query(func.count(APIKey.id)).filter(APIKey.status == "unknown").scalar() or 0
    estimated_prevented_loss = float(blocked_high_risk_30d * 250)
    return {
        "beta_signups_total": int(total_signups),
        "beta_signups_30d": int(signups_30d),
        "active_agents": int(active_agents),
        "tool_calls_30d": int(calls_30d),
        "blocked_high_risk_30d": int(blocked_high_risk_30d),
        "pending_approvals": int(pending_approvals),
        "shadow_keys_detected": int(shadow_keys),
        "estimated_prevented_loss_usd_30d": estimated_prevented_loss,
    }
