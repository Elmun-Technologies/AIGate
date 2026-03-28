#!/bin/sh
set -eu

POSTGRES_HOST="${POSTGRES_HOST:-postgres}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-app}"

# Keep Alembic/SQLAlchemy consistent with the DB env vars when DATABASE_URL is not set.
if [ -z "${DATABASE_URL:-}" ]; then
  export DATABASE_URL="postgresql+psycopg2://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}"
fi

python /app/wait-for-db.py

MIGRATION_MAX_RETRIES="${MIGRATION_MAX_RETRIES:-10}"
MIGRATION_RETRY_DELAY="${MIGRATION_RETRY_DELAY:-3}"

attempt=1
while [ "$attempt" -le "$MIGRATION_MAX_RETRIES" ]; do
  if alembic upgrade head; then
    echo "Alembic migrations applied successfully"
    break
  fi

  if [ "$attempt" -eq "$MIGRATION_MAX_RETRIES" ]; then
    echo "Alembic migrations failed after ${MIGRATION_MAX_RETRIES} attempts"
    exit 1
  fi

  echo "Alembic migration attempt ${attempt} failed, retrying in ${MIGRATION_RETRY_DELAY}s..."
  sleep "$MIGRATION_RETRY_DELAY"
  attempt=$((attempt + 1))
done

exec uvicorn app.main:app --host 0.0.0.0 --port 8000
