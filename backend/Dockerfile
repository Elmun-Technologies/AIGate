# Multi-stage build: development and production targets
FROM python:3.12-slim as base

WORKDIR /app
ENV PYTHONPATH=/app \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

EXPOSE 8000

# Development stage (with hot-reload and debugging)
FROM base as development

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /app/requirements.txt
RUN pip install -r /app/requirements.txt

COPY . /app
RUN chmod +x /app/entrypoint.sh

CMD ["sh", "/app/entrypoint.sh"]

# Production stage (minimal, optimized)
FROM base as production

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY . /app
RUN chmod +x /app/entrypoint.sh

CMD ["sh", "/app/entrypoint.sh"]
