from datetime import datetime, timezone

import requests

from app.core.config import settings


def submit_anchor(*, anchor_date: str, merkle_root: str, leaf_count: int) -> tuple[str, str]:
    """
    Returns (backend_name, anchor_ref).
    If external backend is unavailable, falls back to local_notary deterministic ref.
    """
    if settings.ANCHOR_BACKEND_URL:
        try:
            response = requests.post(
                settings.ANCHOR_BACKEND_URL.rstrip("/"),
                json={
                    "anchor_date": anchor_date,
                    "merkle_root": merkle_root,
                    "leaf_count": leaf_count,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                },
                timeout=4,
            )
            if response.ok:
                payload = response.json()
                anchor_ref = str(payload.get("tx_hash") or payload.get("anchor_ref") or "")
                if anchor_ref:
                    backend_name = str(payload.get("backend") or "external_notary")
                    return backend_name, anchor_ref
        except Exception:
            pass
    return "local_notary", f"local:{anchor_date}:{merkle_root[:24]}"
