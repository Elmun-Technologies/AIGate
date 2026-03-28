# AgentGate (AIGate)
### Runtime Authorization & Governance for AI Agents

AgentGate provides a deterministic enforcement layer for autonomous AI systems. It ensures that every tool call made by an agent is verified against corporate policy, PII filters, and risk thresholds *before* execution.

---

## 🚀 Executive Summary
In the era of autonomous agents, "trust but verify" is not enough. AgentGate introduces **Execution Authority**: a security paradigm where agents cannot perform actions (like sending emails, executing trades, or accessing databases) without a signed, short-lived cryptographic token issued by a central governance layer.

**Core Value Props:**
- **Zero-Trust for Agents**: No runtime token, no execution.
- **Explainable Enforcement**: Every blocked or flagged action includes a risk breakdown (High PII, Confidentiality risk, etc.).
- **Human-in-the-Loop**: High-risk actions are queued for manual approval with redacted payload previews.
- **Immutable Evidence**: Audit trails are anchored using Merkle roots, providing tamper-proof proof of compliance.

---

## 🛠 Product Modules

### 1. Executive Dashboard & ROI
Visualize the security impact of your AI initiatives.
- **Prevented Loss Monitoring**: Quantify the financial risk mitigated by blocking unauthorized high-risk actions.
- **Action Status**: Real-time breakdown of Allowed, Blocked, and Pending actions.
- **Governance Alerts**: Identify "Shadow AI" instances—untracked API keys or providers attempting to connect to your systems.

### 2. Approval Queue
Centralized control for high-stakes decisions.
- **Risk Scoring**: Automated assessment of tool calls based on context and payload.
- **Redaction Previews**: Review sensitive data in a safe, masked view before granting authorization.
- **Audit Association**: Every approval/rejection is tied to a specific user and timestamp in the audit chain.

### 3. Comprehensive Audit
A tamper-proof ledger of every agentic transaction.
- **Audit Pack Export**: One-click generation of a compliance bundle containing timelines, policy snapshots, and verification reports.
- **Chain Verification**: Mathematically prove that audit logs have not been altered since they were recorded.
- **Merkle Anchoring**: Daily hashes are anchored to an immutable notary service.

### 4. Simulator (The "YC Demo")
Test and verify your security posture in a sandboxed environment.
- **deterministic Wedge Flows**: Run scenarios designed to trigger PII blocks, budget caps, and approval requirements.
- **Runtime Token Verification**: See the underlying cryptographic handshakes that authorize execution.

---

## 🏗 Architecture
AgentGate consists of three core components:
1. **Backend (FastAPI)**: The brain. Evaluates OPA policies, assesses risk, and issues signed runtime tokens.
2. **Frontend (Next.js)**: The control plane. Used by CISOs and Legal Ops for monitoring, approvals, and reporting.
3. **Policy Engine (OPA)**: Open Policy Agent integration for complex, multi-layered authorization logic.

---

## ⚡️ Quickstart (Docker)

### 1. Prerequisites
- Docker & Docker Compose
- Disk space: ~2GB

### 2. Installation
```bash
# Clone the repository
git clone https://github.com/Elmun-Technologies/AIGate.git
cd AIGate

# Initialize environment
cp .env.example .env

# Start the stack
docker compose up --build
```

### 3. Usage
- **Access Dashboard**: [http://localhost:3000](http://localhost:3000)
- **Login Credentials**:
    - Email: `admin@example.com`
    - Password: `Admin123!`
- **Run Verification**: Navigate to **Simulator** and launch the **YC Demo** to see the enforcement layer in action.

---

## ⚙️ Configuration & Policies

### Environment Variables
Configure your stack using the `.env` file:
| Variable | Description | Default |
| :--- | :--- | :--- |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://...` |
| `OPA_URL` | Open Policy Agent endpoint | `http://opa:8181` |
| `RUNTIME_SECRET`| Secret used to sign execution tokens | `secret-key-123` |
| `ENVIRONMENT` | deployment mode | `development` |

### Defining Policies (OPA)
AgentGate uses Rego for policy definition. Example policies located in `backend/policies/`:
- `PII_OUTBOUND_BLOCK`: Blocks any tool call containing PII (emails, SSNs, credit cards).
- `BUDGET_CAP`: Prevents tool calls if the agent's session spend exceeds a threshold.
- `DESTINATION_ALLOWLIST`: Restricts tools to specific domains (e.g., `*.github.com`).

---

## 📖 API Documentation
Comprehensive documentation is available at `/docs` when the backend is running.

**Key Endpoints:**
- `POST /telemetry/ingest`: Ingest tool calls for evaluation.
- `POST /approvals/{id}/approve`: Manually authorize a queued action.
- `GET /audit/export-pack`: Export a cryptographically verified compliance report.
- `GET /compliance/controls`: Snapshot of alignment with EU AI Act & NIST AI RMF.

---

## 🛡 Security & Compliance
AgentGate is built for high-assurance environments:
- **NIST AI RMF**: Implements direct controls for Governance, Mapping, and Measuring.
- **EU AI Act**: Provides the "Human Oversight" and "Record Keeping" technical documentation required for high-risk AI systems.
- **Signed Tokens**: Uses HMAC-SHA256 signatures for tool execution authorization, preventing replay attacks and "man-in-the-middle" tool calling.

---
*Created by Elmun Technologies. AgentGate: Nothing executes unless authorized.*
