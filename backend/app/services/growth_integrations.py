import base64
import json
from datetime import datetime, timezone
from typing import Any

import requests

from app.core.config import settings


def track_mixpanel_event(event: str, properties: dict[str, Any]) -> None:
    if not settings.MIXPANEL_TOKEN:
        return
    payload = {
        "event": event,
        "properties": {
            "token": settings.MIXPANEL_TOKEN,
            "time": int(datetime.now(timezone.utc).timestamp()),
            **properties,
        },
    }
    encoded = base64.b64encode(json.dumps(payload).encode("utf-8")).decode("utf-8")
    try:
        requests.post("https://api.mixpanel.com/track", data={"data": encoded}, timeout=2.5)
    except Exception:
        return


def ensure_stripe_customer(email: str, name: str, metadata: dict[str, Any] | None = None) -> str | None:
    if not settings.STRIPE_SECRET_KEY:
        return None
    try:
        response = requests.post(
            "https://api.stripe.com/v1/customers",
            headers={"Authorization": f"Bearer {settings.STRIPE_SECRET_KEY}"},
            data={
                "email": email,
                "name": name,
                **{f"metadata[{k}]": str(v) for k, v in (metadata or {}).items()},
            },
            timeout=4,
        )
        if not response.ok:
            return None
        payload = response.json()
        return str(payload.get("id")) if payload.get("id") else None
    except Exception:
        return None
