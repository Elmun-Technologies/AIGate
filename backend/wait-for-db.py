#!/usr/bin/env python3
import os
import sys
import time
from urllib.parse import urlparse

import psycopg2


DEFAULT_HOST = "postgres"
DEFAULT_PORT = 5432
DEFAULT_USER = "gateway"
DEFAULT_PASSWORD = "gateway"
DEFAULT_DB = "gateway"
DEFAULT_MAX_RETRIES = 60
DEFAULT_RETRY_DELAY = 2.0


def _env(name: str, default: str) -> str:
    value = os.getenv(name)
    return value if value not in (None, "") else default


def _from_database_url() -> dict | None:
    database_url = os.getenv("DATABASE_URL", "").strip()
    if not database_url:
        return None

    # SQLAlchemy URLs may include driver hints like postgresql+psycopg2://
    normalized = database_url.replace("postgresql+", "postgresql", 1)
    parsed = urlparse(normalized)
    if parsed.scheme not in {"postgres", "postgresql"}:
        return None

    dbname = parsed.path.lstrip("/") or DEFAULT_DB
    return {
        "host": parsed.hostname or DEFAULT_HOST,
        "port": parsed.port or DEFAULT_PORT,
        "user": parsed.username or DEFAULT_USER,
        "password": parsed.password or DEFAULT_PASSWORD,
        "dbname": dbname,
    }


def _connection_settings() -> dict:
    from_url = _from_database_url()
    if from_url is not None:
        return from_url

    return {
        "host": _env("POSTGRES_HOST", DEFAULT_HOST),
        "port": int(_env("POSTGRES_PORT", str(DEFAULT_PORT))),
        "user": _env("POSTGRES_USER", DEFAULT_USER),
        "password": _env("POSTGRES_PASSWORD", DEFAULT_PASSWORD),
        "dbname": _env("POSTGRES_DB", DEFAULT_DB),
    }


def _wait_for_server(settings: dict, max_retries: int, retry_delay: float) -> None:
    # Connect to the target database directly. If the DB does not exist, this will fail and retry.
    for attempt in range(1, max_retries + 1):
        try:
            conn = psycopg2.connect(
                host=settings["host"],
                port=settings["port"],
                user=settings["user"],
                password=settings["password"],
                dbname=settings["dbname"],
                connect_timeout=5,
            )
            conn.close()
            print(
                f"Database is ready at {settings['host']}:{settings['port']}/{settings['dbname']}",
                flush=True,
            )
            return
        except Exception as exc:
            print(
                f"[{attempt}/{max_retries}] waiting for database {settings['host']}:{settings['port']}/{settings['dbname']}: {exc}",
                flush=True,
            )
            if attempt == max_retries:
                raise
            time.sleep(retry_delay)


def main() -> int:
    max_retries = int(_env("DB_WAIT_MAX_RETRIES", str(DEFAULT_MAX_RETRIES)))
    retry_delay = float(_env("DB_WAIT_RETRY_DELAY", str(DEFAULT_RETRY_DELAY)))

    settings = _connection_settings()

    try:
        _wait_for_server(settings, max_retries=max_retries, retry_delay=retry_delay)
        return 0
    except Exception:
        print("Database readiness check failed after maximum retries", flush=True)
        return 1


if __name__ == "__main__":
    sys.exit(main())
