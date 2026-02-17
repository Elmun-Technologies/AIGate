# Agent Proxy Gateway (YC Demo MVP)

Inline enforcement control plane for AI agent tool calls. Tool execution is gated by policy evaluation, risk scoring, approvals, and immutable audit events.

## 5-Minute Demo

1. Copy env file:
   ```bash
   cp .env.example .env
   ```
2. Start stack:
   ```bash
   docker compose up --build
   ```
3. Open UI:
   - Frontend: http://localhost:3000
   - Backend health: http://localhost:8000/health
   - API docs: http://localhost:8000/docs

## Login Credentials

- Email: `admin@example.com`
- Password: `Admin123!`

## Demo Flow (Investor Story)

1. Login at [http://localhost:3000](http://localhost:3000).
2. Open **Simulators** and click **Run Demo**.
3. Review the 6-step timeline with status badges (`EXECUTED`, `PENDING_APPROVAL`, `BLOCKED`), risk scores, reasons, and deep links to approvals.
4. Open **Approvals** and approve/reject pending requests.
5. Open **Audit** and inspect the event chain detail; export evidence using **Export JSON/CSV**.
6. Open **Dashboard** and verify real metrics + last demo summary.

## CISO Demo (Spend + Control)

1. Run the simulator to generate executed, pending-approval, and blocked tool calls.
2. Validate enforcement in **Audit** (prompt-injection and exfiltration blocks, approval chain).
3. Open **Spend** to show:
   - total spend (last 7 days)
   - spend by day
   - top agents/tools by spend
   - alert thresholds (daily/monthly, org/agent scope)
   - provider breakdown and shadow AI events via API (`/spend/providers`, `/shadow-ai/events`)
4. Create a low threshold alert and refresh to show alert state transitions.

## What This Proves

- Policy enforcement works inline before tool execution (allow, block, require approval).
- High-risk actions are gated by human approvals and transition to executed/blocked after decision.
- Immutable audit evidence is exportable (JSON/CSV), including prompt-injection and exfiltration blocks.

## Useful Commands

```bash
make up      # docker compose up --build
make down    # docker compose down
make reset   # docker compose down -v
make logs    # tail logs
make demo    # run simulator endpoint and print summary
```

## Service Ports

- Frontend: `3000`
- Backend API: `8000`
- Mock tools: `9000`
- Postgres: `5432`
- Redis: `6379`
