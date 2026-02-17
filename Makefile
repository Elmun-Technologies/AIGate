.PHONY: up down reset logs demo

up:
	@docker compose up --build

down:
	@docker compose down

reset:
	@docker compose down -v

logs:
	@docker compose logs -f --tail=200

demo:
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
