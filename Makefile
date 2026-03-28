.PHONY: up down reset logs simulate demo smoke dev-up dev-down dev-logs dev-reset-quick help

help:
	@echo "AgentGate Development Commands:"
	@echo ""
	@echo "Production:"
	@echo "  make up            - Start full stack (production mode)"
	@echo "  make down          - Stop containers"
	@echo "  make reset         - Stop and remove volumes (clean slate)"
	@echo "  make logs          - Tail logs from all services"
	@echo "  make simulate      - Run YC demo simulation"
	@echo "  make smoke         - Run smoke tests"
	@echo ""
	@echo "Development (faster iteration):"
	@echo "  make dev-up        - Start stack with hot-reload (optimized healthchecks)"
	@echo "  make dev-down      - Stop dev containers"
	@echo "  make dev-logs      - Tail dev logs"
	@echo "  make dev-reset     - Full reset with clean DB (dev mode)"
	@echo "  make dev-reset-quick - Keep DB data, restart containers"
	@echo ""

# Production targets (original behavior)
up:
	@docker compose up --build

down:
	@docker compose down

reset:
	@docker compose down -v

logs:
	@docker compose logs -f --tail=200

# Development targets (optimized for local iteration)
dev-up:
	@echo "Starting AgentGate in development mode..."
	@docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build

dev-down:
	@docker compose -f docker-compose.yml -f docker-compose.dev.yml down

dev-logs:
	@docker compose -f docker-compose.yml -f docker-compose.dev.yml logs -f --tail=100

dev-reset:
	@echo "Full reset: removing containers and volumes..."
	@docker compose -f docker-compose.yml -f docker-compose.dev.yml down -v
	@docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build

dev-reset-quick:
	@echo "Quick restart (preserving DB data)..."
	@docker compose -f docker-compose.yml -f docker-compose.dev.yml restart

# Demo/Simulation targets
simulate:
	@echo "Running simulator..."
	@curl -s -X POST http://localhost:8000/sim/run -H "Content-Type: application/json" > /tmp/agent-gateway-demo.json
	@python3 -c "import json,pathlib; p=pathlib.Path('/tmp/agent-gateway-demo.json'); \
assert p.exists(), 'No simulator output found. Is backend running on http://localhost:8000 ?'; \
d=json.loads(p.read_text()); \
print('Simulation status:', d.get('status')); \
print('Public agent id:', d.get('public_agent_id')); \
print('Confidential agent id:', d.get('confidential_agent_id')); \
print('Steps:'); \
[print(f\"- {s.get('name')}: {(s.get('result') or {}).get('status') or (s.get('result') or {}).get('tool_call_status') or 'n/a'} | reason={(s.get('result') or {}).get('decision_reason') or (s.get('result') or {}).get('reason') or 'n/a'}\") for s in d.get('steps', [])]; \
print('Pending approvals:', d.get('pending_approvals_count'))"

demo: simulate

smoke:
	@echo "Running smoke checks..."
	@curl -sf http://localhost:8000/health >/dev/null && echo "Backend health: OK"
	@curl -sf http://localhost:3000 >/dev/null && echo "Frontend reachable: OK"
	@curl -sf -X POST http://localhost:8000/sim/run -H "Content-Type: application/json" >/tmp/agent-gateway-smoke.json
	@python3 -c "import json,pathlib; p=pathlib.Path('/tmp/agent-gateway-smoke.json'); \
d=json.loads(p.read_text()); \
assert d.get('status') == 'ok', 'Simulation failed'; \
print('Simulation endpoint: OK')"
