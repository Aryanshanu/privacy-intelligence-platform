"""
PrivyGuard Backend — FastAPI
LLM: Groq (openai/gpt-oss-120b) via OpenAI SDK
PII: regex detect() — Aadhaar, PAN, email, phone, IP
Deploy: Hugging Face Spaces, Docker SDK, port 7860
"""

import os
import re
import uuid
import json
import sqlite3
from datetime import datetime, timedelta
from typing import Optional

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from openai import OpenAI

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GROQ_BASE_URL = "https://api.groq.com/openai/v1"
GROQ_MODEL = "openai/gpt-oss-120b"

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./privyguard.db")
DB_PATH = DATABASE_URL.replace("sqlite:///", "")

client: Optional[OpenAI] = None
if GROQ_API_KEY:
    client = OpenAI(base_url=GROQ_BASE_URL, api_key=GROQ_API_KEY)

# ---------------------------------------------------------------------------
# Database Initialization
# ---------------------------------------------------------------------------

def init_db():
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("PRAGMA journal_mode=WAL")

        conn.execute("""
            CREATE TABLE IF NOT EXISTS ropa (
                id TEXT PRIMARY KEY,
                activity TEXT,
                purpose TEXT,
                legal_basis TEXT,
                data_categories TEXT,
                data_subjects TEXT,
                recipients TEXT,
                retention TEXT,
                created_at TEXT
            )
        """)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS controls (
                id TEXT PRIMARY KEY,
                name TEXT,
                description TEXT,
                regulation TEXT,
                status TEXT,
                created_at TEXT
            )
        """)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS dsar (
                id TEXT PRIMARY KEY,
                request_type TEXT,
                subject_name TEXT,
                subject_email TEXT,
                details TEXT,
                status TEXT,
                created_at TEXT,
                due_at TEXT,
                updated_at TEXT
            )
        """)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS consent (
                id TEXT PRIMARY KEY,
                subject_email TEXT,
                purpose TEXT,
                status TEXT,
                created_at TEXT,
                updated_at TEXT
            )
        """)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS audit_log (
                id TEXT PRIMARY KEY,
                table_name TEXT,
                record_id TEXT,
                action TEXT,
                old_value TEXT,
                new_value TEXT,
                timestamp TEXT
            )
        """)

        conn.commit()


init_db()

app = FastAPI(title="PrivyGuard API", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Audit helper — opens its own connection
# ---------------------------------------------------------------------------

def log_mutation(table_name: str, record_id: str, action: str,
                 old_val: Optional[dict] = None,
                 new_val: Optional[dict] = None):
    log_id = str(uuid.uuid4())
    timestamp = datetime.utcnow().isoformat()
    old_json = json.dumps(old_val) if old_val is not None else None
    new_json = json.dumps(new_val) if new_val is not None else None

    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            "INSERT INTO audit_log (id, table_name, record_id, action, old_value, new_value, timestamp) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (log_id, table_name, record_id, action, old_json, new_json, timestamp),
        )
        conn.commit()

# ---------------------------------------------------------------------------
# PII Detection
# ---------------------------------------------------------------------------

PII_PATTERNS = {
    "EMAIL": re.compile(r"\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b"),
    "PAN": re.compile(r"\b[A-Z]{5}[0-9]{4}[A-Z]\b"),
    "AADHAAR": re.compile(r"\b[2-9][0-9]{3}[ -]?[0-9]{4}[ -]?[0-9]{4}\b"),
    "PHONE": re.compile(r"\b(?:\+91[ -]?)?[6-9][0-9]{9}\b"),
    "IP_ADDRESS": re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b"),
}


def detect_pii(text: str) -> list[dict]:
    hits = []
    for pii_type, pattern in PII_PATTERNS.items():
        for match in pattern.finditer(text):
            hits.append({
                "type": pii_type,
                "value": match.group(),
                "start": match.start(),
                "end": match.end(),
            })
    return hits

# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class CopilotQuery(BaseModel):
    question: str
    context: Optional[str] = ""


class DetectRequest(BaseModel):
    text: str


class RopaEntry(BaseModel):
    activity: str
    purpose: str
    legal_basis: str
    data_categories: list[str]
    data_subjects: list[str]
    recipients: list[str] = []
    retention: str = ""


class DSARRequest(BaseModel):
    request_type: str
    subject_name: str
    subject_email: str
    details: str = ""


class DSARStatusUpdate(BaseModel):
    status: str


class ControlEntry(BaseModel):
    name: str
    description: str
    regulation: str = "DPDP"
    status: str = "open"


class ConsentRequest(BaseModel):
    subject_email: str
    purpose: str

# ---------------------------------------------------------------------------
# Root + health
# ---------------------------------------------------------------------------

@app.get("/")
def root():
    return {
        "service": "PrivyGuard API",
        "status": "ok",
        "llm_configured": client is not None,
    }


@app.get("/health")
def health():
    return {"status": "healthy", "groq": "configured" if client else "missing"}

# ---------------------------------------------------------------------------
# Module 1 — PII Discovery
# ---------------------------------------------------------------------------

@app.post("/api/detect")
def detect(req: DetectRequest):
    hits = detect_pii(req.text)
    return {
        "text_length": len(req.text),
        "pii_found": len(hits),
        "entities": hits,
    }


@app.post("/api/detect/file")
async def detect_file(file: UploadFile = File(...)):
    raw = await file.read()
    try:
        text = raw.decode("utf-8", errors="ignore")
    except Exception:
        raise HTTPException(status_code=400, detail="Cannot decode file as text")
    hits = detect_pii(text)
    return {
        "filename": file.filename,
        "text_length": len(text),
        "pii_found": len(hits),
        "entities": hits,
    }

# ---------------------------------------------------------------------------
# Module 2 — Regulatory Copilot
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = (
    "You are PrivyGuard, an expert privacy compliance copilot. "
    "You help DPOs and compliance officers with DPDP Act 2023, DPDP Rules 2025, "
    "and GDPR. Answer precisely. Cite regulation sections when possible. "
    "If the context is empty, say so and answer from general knowledge. "
    "Never invent regulation section numbers."
)


@app.post("/api/copilot/query")
def copilot_query(req: CopilotQuery):
    if client is None:
        return {
            "answer": (
                "Copilot unavailable: GROQ_API_KEY is not configured. "
                "Set the environment variable and restart the service."
            ),
            "model": None,
            "fallback": True,
        }

    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    if req.context:
        messages.append({"role": "system", "content": f"Regulatory context:\n{req.context}"})
    messages.append({"role": "user", "content": req.question})

    try:
        response = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=messages,
            temperature=0.2,
        )
        answer = response.choices[0].message.content
    except Exception as exc:
        return {"answer": f"Copilot error: {exc}", "model": GROQ_MODEL, "fallback": True}

    return {"answer": answer, "model": GROQ_MODEL, "fallback": False}

# ---------------------------------------------------------------------------
# Module 4 — RoPA
# ---------------------------------------------------------------------------

@app.get("/api/ropa")
def list_ropa():
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute("SELECT * FROM ropa").fetchall()

        items = []
        for row in rows:
            item = dict(row)
            for field in ["data_categories", "data_subjects", "recipients"]:
                if item.get(field):
                    item[field] = json.loads(item[field])
            items.append(item)

        return {"count": len(items), "items": items}


@app.post("/api/ropa")
def create_ropa(entry: RopaEntry):
    record_id = str(uuid.uuid4())
    created_at = datetime.utcnow().isoformat()
    record = {
        "id": record_id,
        "activity": entry.activity,
        "purpose": entry.purpose,
        "legal_basis": entry.legal_basis,
        "data_categories": entry.data_categories,
        "data_subjects": entry.data_subjects,
        "recipients": entry.recipients,
        "retention": entry.retention,
        "created_at": created_at,
    }

    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            "INSERT INTO ropa (id, activity, purpose, legal_basis, data_categories, "
            "data_subjects, recipients, retention, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (record_id, entry.activity, entry.purpose, entry.legal_basis,
             json.dumps(entry.data_categories), json.dumps(entry.data_subjects),
             json.dumps(entry.recipients), entry.retention, created_at),
        )
        conn.commit()

    log_mutation("ropa", record_id, "create", None, record)
    return record


@app.delete("/api/ropa/{ropa_id}")
def delete_ropa(ropa_id: str):
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute("SELECT * FROM ropa WHERE id = ?", (ropa_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="RoPA entry not found")
        before = dict(row)
        for field in ["data_categories", "data_subjects", "recipients"]:
            if before.get(field):
                before[field] = json.loads(before[field])

        conn.execute("DELETE FROM ropa WHERE id = ?", (ropa_id,))
        conn.commit()

    log_mutation("ropa", ropa_id, "delete", before, None)
    return {"deleted": ropa_id}

# ---------------------------------------------------------------------------
# Module 5 — Controls
# ---------------------------------------------------------------------------

@app.get("/api/controls")
def list_controls():
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute("SELECT * FROM controls").fetchall()
        items = [dict(row) for row in rows]
        return {"count": len(items), "items": items}


@app.post("/api/controls")
def create_control(entry: ControlEntry):
    record_id = str(uuid.uuid4())
    created_at = datetime.utcnow().isoformat()
    record = {
        "id": record_id,
        "name": entry.name,
        "description": entry.description,
        "regulation": entry.regulation,
        "status": entry.status,
        "created_at": created_at,
    }

    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            "INSERT INTO controls (id, name, description, regulation, status, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (record_id, entry.name, entry.description, entry.regulation,
             entry.status, created_at),
        )
        conn.commit()

    log_mutation("controls", record_id, "create", None, record)
    return record

# ---------------------------------------------------------------------------
# Module 6 — DSAR / Rights
# ---------------------------------------------------------------------------

SLA_DAYS = {
    "access": 30,
    "correction": 30,
    "erasure": 30,
    "consent_withdrawal": 15,
    "grievance": 30,
}


@app.get("/api/rights")
def list_dsars():
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute("SELECT * FROM dsar").fetchall()
        items = [dict(row) for row in rows]
        return {"count": len(items), "items": items}


@app.post("/api/rights")
def create_dsar(req: DSARRequest):
    if req.request_type not in SLA_DAYS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid request_type. Must be one of: {list(SLA_DAYS)}",
        )
    now = datetime.utcnow()
    record_id = str(uuid.uuid4())
    created_at = now.isoformat()
    due_at = (now + timedelta(days=SLA_DAYS[req.request_type])).isoformat()

    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            "INSERT INTO dsar (id, request_type, subject_name, subject_email, details, "
            "status, created_at, due_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (record_id, req.request_type, req.subject_name, req.subject_email,
             req.details, "new", created_at, due_at, None),
        )
        conn.commit()

    record = {
        "id": record_id,
        "request_type": req.request_type,
        "subject_name": req.subject_name,
        "subject_email": req.subject_email,
        "details": req.details,
        "status": "new",
        "created_at": created_at,
        "due_at": due_at,
        "updated_at": None,
    }

    log_mutation("dsar", record_id, "create", None, record)
    return record


@app.patch("/api/rights/{dsar_id}")
def update_dsar_status(dsar_id: str, body: DSARStatusUpdate):
    updated_at = datetime.utcnow().isoformat()
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        before_row = conn.execute("SELECT * FROM dsar WHERE id = ?", (dsar_id,)).fetchone()
        if not before_row:
            raise HTTPException(status_code=404, detail="DSAR not found")
        before = dict(before_row)

        conn.execute(
            "UPDATE dsar SET status = ?, updated_at = ? WHERE id = ?",
            (body.status, updated_at, dsar_id),
        )
        conn.commit()

        after_row = conn.execute("SELECT * FROM dsar WHERE id = ?", (dsar_id,)).fetchone()
        after = dict(after_row)

    log_mutation("dsar", dsar_id, "update", before, after)
    return after

# ---------------------------------------------------------------------------
# Module 6b — Consent Management
# ---------------------------------------------------------------------------

@app.post("/api/consent")
def create_consent(req: ConsentRequest):
    record_id = str(uuid.uuid4())
    created_at = datetime.utcnow().isoformat()
    record = {
        "id": record_id,
        "subject_email": req.subject_email,
        "purpose": req.purpose,
        "status": "given",
        "created_at": created_at,
        "updated_at": None,
    }

    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            "INSERT INTO consent (id, subject_email, purpose, status, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (record_id, req.subject_email, req.purpose, "given", created_at, None),
        )
        conn.commit()

    log_mutation("consent", record_id, "create", None, record)
    return record


@app.get("/api/consent/{email}")
def list_consent(email: str):
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT * FROM consent WHERE subject_email = ?", (email,)
        ).fetchall()
        items = [dict(row) for row in rows]
        return {"count": len(items), "items": items}


@app.delete("/api/consent/{consent_id}")
def withdraw_consent(consent_id: str):
    updated_at = datetime.utcnow().isoformat()
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        before_row = conn.execute(
            "SELECT * FROM consent WHERE id = ?", (consent_id,)
        ).fetchone()
        if not before_row:
            raise HTTPException(status_code=404, detail="Consent not found")
        before = dict(before_row)

        conn.execute(
            "UPDATE consent SET status = ?, updated_at = ? WHERE id = ?",
            ("withdrawn", updated_at, consent_id),
        )
        conn.commit()

        after_row = conn.execute(
            "SELECT * FROM consent WHERE id = ?", (consent_id,)
        ).fetchone()
        after = dict(after_row)

    log_mutation("consent", consent_id, "update", before, after)
    return after

# ---------------------------------------------------------------------------
# Audit log reader
# ---------------------------------------------------------------------------

@app.get("/api/audit")
def list_audit(table: Optional[str] = None, record_id: Optional[str] = None):
    query = "SELECT * FROM audit_log"
    conditions = []
    params = []

    if table:
        conditions.append("table_name = ?")
        params.append(table)
    if record_id:
        conditions.append("record_id = ?")
        params.append(record_id)

    if conditions:
        query += " WHERE " + " AND ".join(conditions)
    query += " ORDER BY timestamp DESC"

    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(query, params).fetchall()
        items = []
        for row in rows:
            item = dict(row)
            if item.get("old_value"):
                item["old_value"] = json.loads(item["old_value"])
            if item.get("new_value"):
                item["new_value"] = json.loads(item["new_value"])
            items.append(item)
        return {"count": len(items), "items": items}

# ---------------------------------------------------------------------------
# Module 7 — Analytics
# ---------------------------------------------------------------------------

@app.get("/api/analytics/summary")
def analytics_summary():
    with sqlite3.connect(DB_PATH) as conn:
        ropa_count = conn.execute("SELECT count(*) FROM ropa").fetchone()[0]
        dsar_count = conn.execute("SELECT count(*) FROM dsar").fetchone()[0]
        open_dsars = conn.execute("SELECT count(*) FROM dsar WHERE status != 'closed'").fetchone()[0]
        controls_count = conn.execute("SELECT count(*) FROM controls").fetchone()[0]
        consent_count = conn.execute("SELECT count(*) FROM consent").fetchone()[0]
        consent_active = conn.execute("SELECT count(*) FROM consent WHERE status = 'given'").fetchone()[0]

    return {
        "ropa_count": ropa_count,
        "dsar_count": dsar_count,
        "open_dsars": open_dsars,
        "controls_count": controls_count,
        "consent_count": consent_count,
        "consent_active": consent_active,
        "llm_configured": client is not None,
    }


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "7860"))
    uvicorn.run(app, host="0.0.0.0", port=port)
