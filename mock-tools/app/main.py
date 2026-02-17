from datetime import datetime, timezone

from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="Mock Tools")


class SendEmailRequest(BaseModel):
    to: str
    subject: str
    body: str


class ExternalPostRequest(BaseModel):
    url: str
    payload: dict


class ReadDbRequest(BaseModel):
    query: str


@app.post("/mock/send_email")
def send_email(payload: SendEmailRequest) -> dict:
    return {
        "tool": "send_email",
        "status": "sent",
        "to": payload.to,
        "subject": payload.subject,
        "sent_at": datetime.now(timezone.utc).isoformat(),
    }


@app.post("/mock/external_post")
def external_post(payload: ExternalPostRequest) -> dict:
    return {
        "tool": "external_post",
        "status": "posted",
        "url": payload.url,
        "payload_size": len(str(payload.payload)),
        "posted_at": datetime.now(timezone.utc).isoformat(),
    }


@app.post("/mock/read_db")
def read_db(payload: ReadDbRequest) -> dict:
    rows = [
        {"id": 1, "name": "alpha", "query_echo": payload.query},
        {"id": 2, "name": "beta", "query_echo": payload.query},
    ]
    return {
        "tool": "read_db",
        "status": "ok",
        "rows": rows,
        "row_count": len(rows),
    }


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
