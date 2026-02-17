from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.agents import router as agents_router
from app.api.routes.approvals import router as approvals_router
from app.api.routes.audit import router as audit_router
from app.api.routes.auth import router as auth_router
from app.api.routes.compliance import router as compliance_router
from app.api.routes.dashboard import router as dashboard_router
from app.api.routes.gateway import router as gateway_router
from app.api.routes.policies import router as policies_router
from app.api.routes.sim import router as simulators_router
from app.api.routes.spend import router as spend_router
from app.api.routes.telemetry import router as telemetry_router
from app.api.routes.tool_calls import router as tool_calls_router
from app.api.routes.tools import router as tools_router
from app.core.config import settings
from app.db.session import SessionLocal
from app.seed import seed_defaults

app = FastAPI(title=settings.PROJECT_NAME)

cors_origins = list(dict.fromkeys([*settings.CORS_ORIGINS, "http://localhost:3000"]))

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(agents_router)
app.include_router(policies_router)
app.include_router(tools_router)
app.include_router(gateway_router)
app.include_router(approvals_router)
app.include_router(audit_router)
app.include_router(tool_calls_router)
app.include_router(compliance_router)
app.include_router(simulators_router)
app.include_router(dashboard_router)
app.include_router(spend_router)
app.include_router(telemetry_router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.on_event("startup")
def startup_seed() -> None:
    db = SessionLocal()
    try:
        seed_defaults(db)
    finally:
        db.close()
