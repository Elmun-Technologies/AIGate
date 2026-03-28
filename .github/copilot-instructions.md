# AgentGate: AI Coding Instructions

AgentGate is an **execution authority layer for autonomous AI agents**. Understand these architectural patterns and critical flows before making changes.

## Architecture Overview

**Three-tier stack:**
- **Frontend** (Next.js 14, TypeScript): Dashboard for approvals, audit, policies, spend alerts
- **Backend** (FastAPI, SQLAlchemy): Core authorization, policy evaluation, audit chain, risk scoring
- **Services**: PostgreSQL (state), Redis (queues), OPA (optional policy engine), Mock-tools (test agent)

**Critical data flow (tool execution):**
1. Agent calls `POST /gateway/tool-call` with tool name, args, prompt
2. System extracts API key, runs risk scoring (`calculate_risk_with_breakdown`)
3. Policy engine evaluates rules (OPA → YAML fallback) against context
4. Decision: `ALLOW`, `BLOCK`, or `REQUIRE_APPROVAL` with signed runtime token
5. Audit chain records decision (Merkle-hashed chain for tamper-evidence)
6. Worker verifies token before tool execution; approvals block execution until resolved

## Key Patterns & Files

### Policy Evaluation (OPA + YAML fallback)
- **Entry**: [backend/app/services/policy_runtime.py](backend/app/services/policy_runtime.py#L7) — tries OPA at `settings.OPA_URL`, falls back to YAML
- **YAML engine**: [backend/app/services/policy_engine.py](backend/app/services/policy_engine.py) — matches rules via atomic conditions (`tool_in`, `risk_score_gte`, `agent_data_classification_in`, `payload_contains_pii`, etc.) with AND/OR nesting
- **OPA policy**: [backend/policies/agentgate.rego](backend/policies/agentgate.rego) — Rego rules (confidential block, high-risk approval, prompt injection block)
- **Templates**: [backend/app/services/policy_templates.py](backend/app/services/policy_templates.py) — preset policies like `PII_OUTBOUND_BLOCK`, `CONFIDENTIAL_APPROVAL_REQUIRED`

### Risk Scoring (Deterministic & Explainable)
- **Entry**: [backend/app/services/risk.py](backend/app/services/risk.py#L144) `calculate_risk_with_breakdown()`
- Always call with: `tool_name`, `tool_risk_level` (high/medium/low), `prompt`, `args`, `agent_classification` (Public/Confidential/PII), `destination_allowlist`, `spend_spike`, `owner_missing`
- **Factors**: classification_points (Confidential=20), payload_contains_pii (30), destination_unknown (25), spend_spike (15), owner_missing (10)
- **Allowlist offset**: `-15` points if destination in allowlist
- **PII detection**: Uses prompt + args scanning (regex patterns for email, SSN, credit card)
- Return: `{"score": int, "factors": list, "payload_contains_pii": bool, "destination_domain": str}`

### Runtime Authority (Signed Tokens)
- **Token issuance**: [backend/app/services/runtime_authority.py](backend/app/services/runtime_authority.py#L28) `issue_runtime_token()` — HMAC-SHA256, scoped to `tool_call_id`, `agent_id`, `tool`, short TTL (e.g., 60s)
- **Verification**: `verify_runtime_token()` — Workers must validate before execution; mismatches block and audit
- **Format**: `header.payload.signature` (base64url, canonical JSON for determinism)

### Audit Chain (Merkle Hash Integrity)
- **Chain building**: [backend/app/services/audit_chain.py](backend/app/services/audit_chain.py#L12) `append_audit_event()` — each event links to prev via SHA256 hash
- **Integrity**: [backend/app/services/audit_integrity.py](backend/app/services/audit_integrity.py#L40) `verify_stream_chain()` — detects tampering, cycles, invalid roots
- **Daily anchoring**: `POST /audit/anchors/anchor?day=YYYY-MM-DD` — hashes events into Merkle root, pluggable backend (default: local notary)
- **Model**: [backend/app/models/audit_event.py](backend/app/models/audit_event.py) — stream_id (tool_call_id), event_type, payload_redacted_json, chain_hash, prev_hash

### Approval Workflow
- **Models**: [backend/app/models/approval_request.py](backend/app/models/approval_request.py) — status (pending/approved/rejected), decision_reason, decided_by_email
- **Redaction**: [backend/app/services/redaction.py](backend/app/services/redaction.py) — PII/secrets masked in approval payloads for security_approver review
- **Route**: [backend/app/api/routes/approvals.py](backend/app/api/routes/approvals.py) — requires `security_approver` role

### Gateway Service (Central Orchestrator)
- **Main entry**: [backend/app/services/gateway_service.py](backend/app/services/gateway_service.py#L52) `process_gateway_tool_call()` 
- **Flow**: normalize payload → verify API key → risk scoring → policy eval → decision → audit chain → enqueue jobs (spend, governance)
- **Context for policy**: tool, prompt, agent_data_classification, risk_score, payload_contains_pii, destination_domain, spend_agent_day_usd, owner_missing

### Org Context Middleware
- **Pattern**: [backend/app/middleware/org_context.py](backend/app/middleware/org_context.py) — extracts `X-Org-Id` header, multi-tenant scoping (stored in request.state.org_id)
- All models inherit from [backend/app/db/base.py](backend/app/db/base.py) via SQLAlchemy ORM

## Development Workflows

### Start Development
```bash
docker compose up --build  # Postgres, Redis, OPA (if OPA_URL set), backend, frontend
# http://localhost:3000 (admin@example.com / Admin123!)
# http://localhost:8000/docs (FastAPI SwaggerUI)
```

### Run Simulator
```bash
make simulate  # or: curl -X POST http://localhost:8000/sim/run
# Returns deterministic YC demo: 2 agents, various tool calls, approvals, spend alerts
```

### Run Tests
```bash
cd backend
pytest tests/  # test_risk_scoring, test_audit_merkle, test_policy_runtime, etc.
# Each test file validates specific systems in isolation (determinism, integrity, rule matching)
```

### Add Dependencies
- **Python**: Edit [backend/requirements.txt](backend/requirements.txt), rebuild backend container
- **Frontend**: Edit [frontend/package.json](frontend/package.json), rebuild

## SQL & Alembic Migrations
- **Migrations**: [backend/alembic/versions/](backend/alembic/versions/) — 6 versions covering initial schema, spend tracing, aggregation, AI governance, growth, loss assumptions
- **Add migration**: `alembic revision --autogenerate -m "description"`
- **Apply**: runs on backend startup via [backend/app/seed.py](backend/app/seed.py)

## Role-Based Access Control (RBAC)
- **Roles**: admin, security_approver, developer, viewer
- **Enforcement**: [backend/app/api/deps.py](backend/app/api/deps.py) `require_roles()` decorator
- **Token**: Bearer token from `POST /auth/login`, JWT payload stores user.role

## Common Tasks

**Add a new policy rule**: Update [backend/policies/agentgate.rego](backend/policies/agentgate.rego) or add YAML template, test via POST /policies

**Modify risk factors**: Edit [backend/app/services/risk.py](backend/app/services/risk.py), add atomic check in CLASSIFICATION_WEIGHTS or factor list, add test case

**New approval field**: Update [backend/app/models/approval_request.py](backend/app/models/approval_request.py), create Alembic migration, update [backend/app/schemas/approval.py](backend/app/schemas/approval.py)

**Trace tool execution**: Search `process_gateway_tool_call` → risk scoring → policy eval → audit append → token issue → worker task approval/execute

**Fix audit chain**: Verify via `/audit/anchors/verify?day=YYYY-MM-DD`; if tampered, chain integrity check in [backend/app/services/audit_integrity.py](backend/app/services/audit_integrity.py) catches it

## Testing Patterns
- **Determinism**: Run same inputs twice, compare outputs (e.g., test_risk_scoring_is_deterministic)
- **Allowlist behavior**: Score should drop when destination in allowlist (test_risk_scoring_respects_allowlist_offset)
- **Policy matching**: Use synthetic context dicts, verify `matches_condition()` logic
- **Audit integrity**: Build chain, verify no cycles, correct hashes (test_audit_pack.py)
