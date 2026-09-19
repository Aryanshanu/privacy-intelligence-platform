# PrivyGuard

AI-driven continuous privacy governance.

Lifecycle: **Discover → Understand → Assess → Govern → Remediate → Monitor**

Target users: DPOs, privacy teams, compliance officers.

## Stack

- Frontend: Next.js 14 (App Router), TypeScript, Tailwind, shadcn/ui — deployed to Vercel
- Backend: FastAPI, Python 3.12 — deployed to Hugging Face Spaces (Docker SDK, port 7860)
- LLM: Groq, model `llama-3.3-70b-versatile`, OpenAI-compatible endpoint
- PII detection: regex `detect()` in `backend/main.py` — Aadhaar, PAN, email, phone, IP
- Vector store: Qdrant
- Structured data: SQLite (dev) / Postgres (prod)
- Embeddings: local, `BAAI/bge-small-en-v1.5` via `sentence-transformers`

All components are open source. No OpenAI, no Azure, no proprietary endpoints.

## Modules

1. AI-Powered Data Discovery & Classification
2. AI Regulatory & Policy Copilot
3. AI Privacy Governance
4. Data Processing & Privacy Intelligence (RoPA)
5. Privacy Risk & Control Management
6. Data Principal Rights Automation (DSAR)
7. Privacy Analytics & Executive Dashboard

## Open-source deployment

### 1. Backend → Hugging Face Spaces

1. Create a Space at https://huggingface.co/new-space
   - SDK: **Docker**
   - Hardware: **CPU basic (free)**
2. In Space **Settings → Variables and secrets**, add:
   - `GROQ_API_KEY` = your free key from https://console.groq.com
3. Push the repo:
   ```bash
   git remote add hf https://huggingface.co/spaces/<user>/privyguard
   git push hf main
   ```
Spaces builds automatically. Public URL:
https://<user>-privyguard.hf.space

### 2. Frontend → Vercel
Set the environment variable in the Vercel project:

```env
NEXT_PUBLIC_API_BASE_URL=https://<user>-privyguard.hf.space
```
Redeploy. The /demo route is read-only and remains available.

### 3. Local development
```bash
cp .env.example .env
# add GROQ_API_KEY to .env
docker compose up --build
```
Backend: http://localhost:8000
Qdrant: http://localhost:6333

Pull nothing from Ollama. The LLM is Groq.

Graceful fallback
If GROQ_API_KEY is missing, /api/copilot/query returns a friendly message
with HTTP 200. It does not crash. This behaviour must be preserved.

Hard rules
Open source only. No OpenAI, no Azure.

CPU-only backend. No GPU assumptions.

No Ollama anywhere in the deployed path.

Verify any new PyPI package before adding it.

PII masked in logs by default.
