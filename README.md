# EchoFAQ — Voice FAQ Assistant

Browser-based voice FAQ demo. Ask by mic or keyboard; answers come **only from one FAQ file** via local RAG. Grounded replies stream over SSE, show live in the UI, and are spoken with neural TTS. If the FAQ does not cover the question, the app refuses instead of guessing.

Demo / portfolio use — not a phone bot, CRM, or multi-tenant knowledge base.

**Flow:** Chrome mic (Web Speech) → FastAPI → FAISS retrieval over an in-memory FAQ index → Ollama (`qwen2.5:7b`) streams a grounded answer → Kokoro speaks completed sentences in the browser.

## What’s included

- Continuous voice session until you end it (auto-submit after a short pause)
- Typed questions answered in text only (no TTS)
- Live transcript + streaming assistant replies
- Neural American English TTS via **Kokoro** (Web Speech fallback)
- Upload `.txt` / `.md` to replace the bundled sample FAQ
- Markdown FAQ preview modal for the active document
- Explicit refusal when similarity is below the cutoff

## Tech stack

| Layer | Choices |
| --- | --- |
| Frontend | React 19, TypeScript, Vite 8 |
| Styling | Tailwind CSS v4 (`@tailwindcss/vite`), custom CSS (Wavelength Studio UI) |
| Speech in | Web Speech API — `SpeechRecognition` / `webkitSpeechRecognition` (`en-US`) |
| Speech out | **Kokoro** (`kokoro-js` + ONNX / Transformers.js) neural TTS; Web Speech `speechSynthesis` fallback |
| Markdown | `react-markdown` (FAQ preview) |
| Backend | Python 3.12, FastAPI, Uvicorn |
| Validation | Pydantic v2 |
| RAG | LangChain + `langchain-text-splitters` + `langchain-ollama` |
| Vector store | FAISS (`faiss-cpu`, in-memory) |
| Chat LLM | Local [Ollama](https://ollama.com) — default `qwen2.5:7b` |
| Embeddings | Local Ollama — default `nomic-embed-text` |
| Streaming | Server-Sent Events (SSE) token / done / refusal events |
| Uploads | `python-multipart` |
| Config | `python-dotenv` + `.env` / `.env.example` |
| Delivery | Docker Compose (frontend nginx + backend) |
| Tests | Backend: `pytest` + `httpx` (Ollama mocked). Frontend: Vitest + Testing Library |

### Libraries & smaller pieces

**Backend**

- `fastapi` / `uvicorn[standard]` — health, status, document, upload, chat routes
- `pydantic` — request/response models
- `langchain-text-splitters` — chunk the FAQ for indexing
- `langchain-ollama` — chat + embeddings against local Ollama
- `faiss-cpu` — similarity search; index rebuilt on startup / upload
- `httpx` — used in API tests
- Similarity cutoff (`SIMILARITY_CUTOFF`) drives grounded answer vs refusal

**Frontend**

- `react` / `react-dom` / `vite` / `typescript` — Wavelength Studio UI
- `tailwindcss` — layout and motion styles
- `kokoro-js` — in-browser neural TTS (`af_heart` voice; first visit caches ~80MB from Hugging Face)
- Web Speech recognition — continuous listen + silence auto-submit
- `react-markdown` — rendered FAQ preview
- Vitest — sentence buffer / speech helper unit tests

**API surface (browser → FastAPI only)**

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness |
| `GET` | `/status` | Ready flag, active source (`sample` / `upload`), filename |
| `GET` | `/document` | Active FAQ text for the preview modal |
| `POST` | `/upload` | Replace index with a new `.txt` / `.md` file |
| `POST` | `/chat` | Retrieve + grounded SSE stream, or JSON refusal |

The browser never calls Ollama directly. TTS runs entirely in the browser (Kokoro / Web Speech).

## Ports

| Service | URL |
| --- | --- |
| Frontend | http://localhost:3002 |
| API | http://localhost:8002 |
| Ollama | http://localhost:11434 |

## 1. Install Ollama and pull models

Install from <https://ollama.com/download> (macOS: `brew install ollama`), start it, then pull both models:

```bash
ollama serve   # skip if the Ollama app is already running
ollama pull qwen2.5:7b
ollama pull nomic-embed-text
```

## 2a. Run with Docker

Requires Docker Desktop and Ollama running on the host.

```bash
docker compose up --build
```

Open <http://localhost:3002> in **Chrome**.

- Backend reaches Ollama via `OLLAMA_BASE_URL=http://host.docker.internal:11434`.
- Frontend is built with `VITE_API_BASE=http://localhost:8002` (browser → host-mapped API, not Docker DNS).
- Optional overrides: copy `.env.example` to `.env` and edit.

Stop with `Ctrl+C`, or: `docker compose down`.

## 2b. Run locally

**Backend** (Python 3.12):

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8002
```

**Frontend:**

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev        # http://localhost:3002
```

## Environment

| Variable | Where | Notes |
| --- | --- | --- |
| `OLLAMA_BASE_URL` | `backend/.env` / Compose | Default `http://127.0.0.1:11434`; Compose uses `host.docker.internal` |
| `OLLAMA_CHAT_MODEL` | `backend/.env` / Compose | Default `qwen2.5:7b` |
| `OLLAMA_EMBED_MODEL` | `backend/.env` / Compose | Default `nomic-embed-text` |
| `SIMILARITY_CUTOFF` | `backend/.env` / Compose | Default `0.45` — below this → refusal |
| `CORS_ORIGINS` | `backend/.env` / Compose | Default `http://localhost:3002,...` |
| `VITE_API_BASE` | frontend `.env.local` / Compose build arg | Default `http://localhost:8002` |
| `FRONTEND_PORT` / `BACKEND_PORT` | Compose | Host ports (defaults `3002` / `8002`) |

No cloud API keys are required for the core demo.

## Tests

```bash
# Backend (Ollama mocked — no live model calls)
cd backend && PYTHONPATH=. pytest -v

# Frontend
cd frontend && npm test
```

## Known limitations

- **In-memory index** — FAISS lives in process memory; nothing is persisted across restarts.
- **Restart resets to sample** — uploaded FAQ is lost when the API restarts.
- **One file at a time** — a valid `.txt` / `.md` upload (200–12,000 characters) replaces the active FAQ.
- **Chrome recommended** — mic input uses Web Speech recognition (`en-US`).
- **Kokoro first load** — neural TTS downloads ~80MB from Hugging Face once, then caches in the browser.
- **Local models** — quality and latency depend on your machine and the Ollama models; cold start can be slow.
- **No telephony** — browser only; no phone calls, WhatsApp, or WebRTC.

## Docs

- [Design spec](docs/superpowers/specs/2026-10-12-voice-faq-assistant-design.md)
- [Implementation plan](docs/superpowers/plans/2026-10-12-voice-faq-assistant.md)
