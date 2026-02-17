import json

import redis
from rq import Queue

from app.core.config import settings


RAW_PAYLOAD_TTL_SECONDS = 60 * 60 * 24


def get_redis() -> redis.Redis:
    return redis.Redis.from_url(settings.REDIS_URL, decode_responses=False)


def get_queue() -> Queue:
    return Queue("gateway", connection=get_redis())


def set_raw_payload(tool_call_id: str, payload: dict) -> None:
    key = f"toolcall:raw:{tool_call_id}"
    get_redis().setex(key, RAW_PAYLOAD_TTL_SECONDS, json.dumps(payload).encode("utf-8"))


def get_raw_payload(tool_call_id: str) -> dict | None:
    key = f"toolcall:raw:{tool_call_id}"
    raw = get_redis().get(key)
    if not raw:
        return None
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8")
    return json.loads(raw)
