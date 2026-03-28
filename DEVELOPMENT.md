# Local Development Setup Guide

## Quick Start (Development Mode - Optimized)

```bash
# 1. Setup environment (first time only)
cp .env.local .env

# 2. Start dev stack (faster startup, hot-reload enabled)
make dev-up

# 3. Access services
# Frontend: http://localhost:3000 (admin@example.com / Admin123!)
# Backend API: http://localhost:8000
# Swagger UI: http://localhost:8000/docs
# Mock Tools: http://localhost:9000
```

**Dev mode includes:**
- ✅ Reduced healthcheck intervals (2s vs 5s) — faster startup
- ✅ Python `PYTHONUNBUFFERED=1` — immediate log output
- ✅ Next.js hot-reload enabled (auto-refresh on file changes)
- ✅ Build targets: `development` (with debugging tools) and `production` (minimal)
- ✅ Skipped optional services: OPA, Stripe, Mixpanel (configure in `.env` if needed)

## Development Commands

```bash
# Start development stack
make dev-up

# Stop containers (preserve DB)
make dev-down

# Restart containers quickly (preserve DB and data)
make dev-reset-quick

# Full reset (delete DB and volumes)
make dev-reset

# Tail logs from dev containers
make dev-logs

# Run simulator demo
make simulate

# Run smoke tests
make smoke
```

## Production Mode (Full, Secure Stack)

```bash
make up      # Start production stack
make down    # Stop
make reset   # Full reset
make logs    # View logs
make simulate # Run demo
```

## Configuration

### Development (`docker-compose.dev.yml`)
- Overrides healthcheck intervals: 2s (faster startup)
- Adds `PYTHONUNBUFFERED=1` for real-time logs
- Sets `LOG_LEVEL=debug` for verbose output
- Uses `development` build target with full tools

### Environment Files
- **`.env.local`** (dev defaults) — Copy and customize for your setup
- **`.env.example`** (template) — Reference for all available variables

### Optional Services (disabled by default in dev)
Uncomment in `.env` to enable:
```env
OPA_URL=http://opa:8181              # Policy engine (requires OPA container setup)
ANCHOR_BACKEND_URL=...               # Audit anchoring service
MIXPANEL_TOKEN=...                   # Analytics
STRIPE_SECRET_KEY=...                # Billing
```

## Troubleshooting

**Issue: "service_healthy" condition timeout**
- Reduce retry count or increase timeout in `docker-compose.dev.yml`
- Check logs: `make dev-logs`

**Issue: Port 3000/8000/5432 already in use**
- Kill process: `lsof -i :3000 | kill` (replace with port number)
- Or change port in `docker-compose.dev.yml`

**Issue: DB migration fails**
- Full reset: `make dev-reset`
- Check migration files in `backend/alembic/versions/`

**Issue: Frontend shows "Cannot reach backend"**
- Ensure backend is healthy: `curl http://localhost:8000/health`
- Check `NEXT_PUBLIC_API_URL` env in `docker-compose.dev.yml`

## Development Workflow

1. **Start stack**: `make dev-up` (wait ~20s for all services healthy)
2. **Edit code** (backend or frontend) → auto-reload via Docker volumes
3. **Check logs**: `make dev-logs` or individual service logs
4. **Test**: Visit UI at http://localhost:3000 or hit API at http://localhost:8000/docs
5. **Stop**: `make dev-down` (DB data preserved)

## Build Targets

### Backend
- `development` (default in dev) — includes `build-essential` and `curl` for debugging
- `production` — minimal, curl only, optimized for deployment

### Frontend
- `development` — `npm install` (includes dev deps), Next.js dev server
- `builder` — intermediate stage (compiles Next.js)
- `production` — minimal, `npm ci --only=production`, `npm start`

## Docker Compose File Layering

Dev mode uses Docker Compose file composition to override production settings:

```bash
# Production (default)
docker compose up

# Development (overrides production settings)
docker compose -f docker-compose.yml -f docker-compose.dev.yml up

# Or use make wrapper
make dev-up
```

Overrides in `docker-compose.dev.yml`:
- Healthcheck intervals and retries
- Build targets (`development` instead of `production`)
- Log levels
- Dependencies (mock-tools → `service_healthy`)
