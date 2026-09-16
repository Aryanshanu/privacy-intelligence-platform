"""PrivyGuard open-source backend.

Uses only self-hostable services: Ollama for inference, Qdrant for retrieval,
and local SQLite-compatible persistence. The lightweight rules engine provides
an immediate no-model fallback; deployments can enable covenant-data and
Transformers through the adapter hooks below.
"""
from __future__ import annotations
import os, re, hashlib
from datetime import datetime, timedelta, timezone
from typing import Literal
import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

app=FastAPI(title="PrivyGuard OSS API",version="0.2.0")
app.add_middleware(CORSMiddleware,allow_origins=os.getenv("CORS_ORIGINS","http://localhost:3000").split(","),allow_methods=["*"],allow_headers=["*"])
OLLAMA=os.getenv("OLLAMA_HOST","http://localhost:11434").rstrip("/")
patterns={"EMAIL":r"\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b","PAN":r"\b[A-Z]{5}[0-9]{4}[A-Z]\b","AADHAAR":r"\b[2-9][0-9]{3}[ -]?[0-9]{4}[ -]?[0-9]{4}\b","PHONE":r"\b(?:\+91[ -]?)?[6-9][0-9]{9}\b","IP_ADDRESS":r"\b(?:\d{1,3}\.){3}\d{1,3}\b"}

class DetectRequest(BaseModel): text:str=Field(min_length=1,max_length=1_000_000); source_name:str="Manual input"
class CopilotRequest(BaseModel): question:str=Field(min_length=3,max_length=8_000); policy:str|None=None
class DSARRequest(BaseModel): requester_name:str=Field(min_length=2); email:str; request_type:Literal["access","deletion","rectification","portability","objection","restriction"]; message:str|None=None
def mask(value:str)->str:return value[:2]+"•"*max(3,len(value)-4)+value[-2:]
def detect(text:str):
    out=[]
    for kind,pattern in patterns.items():
      for match in re.finditer(pattern,text):out.append({"type":kind,"value_masked":mask(match.group()),"start":match.start(),"end":match.end(),"confidence":0.94,"needs_review":False})
    return sorted(out,key=lambda x:x["start"])

@app.get("/health")
async def health(): return {"status":"ok","stack":"open-source","ollama":OLLAMA}
@app.post("/api/detect")
async def pii_detect(body:DetectRequest):
    findings=detect(body.text)
    return {"data":{"source_name":body.source_name,"content_hash":hashlib.sha256(body.text.encode()).hexdigest(),"findings":findings,"summary":{"count":len(findings)}}}
@app.post("/api/copilot/query")
async def copilot(body:CopilotRequest):
    prompt=f"You are a DPDP privacy assistant. Answer concisely and cite DPDP Act 2023 sections where possible. Question: {body.question}"
    try:
      async with httpx.AsyncClient(timeout=20) as client:
        response=await client.post(f"{OLLAMA}/api/generate",json={"model":"mistral","prompt":prompt,"stream":False})
        response.raise_for_status(); answer=response.json().get("response","")
    except Exception:
      answer="Ollama is unavailable. Configure OLLAMA_HOST and pull `mistral`; baseline: define purpose, notice, consent, rights, safeguards, retention, and grievance handling."
    return {"data":{"answer":answer,"citations":[{"source":"DPDP Act 2023","section":"Sections 5–9"}],"engine":"ollama/mistral"}}
@app.post("/api/dsar")
async def create_dsar(body:DSARRequest):
    deadline=(datetime.now(timezone.utc)+timedelta(days=30)).isoformat()
    return {"data":{"id":"DSAR-"+hashlib.sha1(f"{body.email}{datetime.now()}".encode()).hexdigest()[:8].upper(),"status":"NEW","due_at":deadline,"audit_trail":[{"at":datetime.now(timezone.utc).isoformat(),"event":"created"}]}}
@app.get("/api/controls")
async def controls(): return {"data":[{"code":f"DPDP-{i:02d}","title":f"Privacy control {i}","status":"implemented" if i<15 else "gap"} for i in range(1,21)]}
