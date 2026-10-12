# EchoFAQ — Voice FAQ Assistant

EchoFAQ is a browser-based, turn-by-turn voice FAQ assistant. Ask a question by voice (or type it), and it answers **only from one FAQ file** using local RAG. The reply streams in live and is spoken aloud sentence by sentence. If the FAQ doesn't cover the question, it says so instead of guessing.

- **Frontend:** React (Vite) + Tailwind — "Signal Desk" UI, Web Speech API for STT/TTS, SSE client
- **Backend:** FastAPI + LangChain + FAISS (in-memory index)
- **Models:** local [Ollama](https://ollama.com) — chat `qwen2.5:7b`, embeddings `nomic-embed-text`
- A bundled sample FAQ loads at startup; you can upload a `.txt` / `.md` file to replace it.

## Ports

| Service  | URL                     |
| -------- | ----------------------- |
| Frontend | http://localhost:3002   |
| API      | http://localhost:8002   |
| Ollama   | http://localhost:11434  |

## 1. Install Ollama and pull models

Install Ollama from <https://ollama.com/download> (macOS: `brew install ollama`), start it, then pull both models:

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

- The backend container reaches Ollama via `OLLAMA_BASE_URL=http://host.docker.internal:11434`.
- The frontend is built with `VITE_API_BASE=http://localhost:8002` because the browser calls the host-mapped API port, not Docker DNS.
- Optional overrides: copy `.env.example` to `.env` and edit.

## 2b. Run locally

Backend (Python 3.12):

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8002
```

Frontend:

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev        # http://localhost:3002
```

## Tests

```bash
# Backend
cd backend && PYTHONPATH=. pytest -v

# Frontend
cd frontend && npx vitest run
```

## Configuration

| Variable              | Default                                       |
| --------------------- | --------------------------------------------- |
| `OLLAMA_BASE_URL`     | `http://127.0.0.1:11434`                      |
| `OLLAMA_CHAT_MODEL`   | `qwen2.5:7b`                                  |
| `OLLAMA_EMBED_MODEL`  | `nomic-embed-text`                            |
| `SIMILARITY_CUTOFF`   | `0.45`                                        |
| `CORS_ORIGINS`        | `http://localhost:3002,http://127.0.0.1:3002` |
| `VITE_API_BASE`       | `http://localhost:8002`                       |

## Limitations

- **In-memory index:** the FAISS index is rebuilt at startup and replaced on upload; nothing is persisted across restarts.
- **One FAQ at a time:** uploads (`.txt` / `.md`, 200–12,000 characters) replace the active FAQ.
- **Chrome voice only:** speech recognition/synthesis uses the Web Speech API (`en-US`). Other browsers can still type questions and read streamed answers.
- **Local models:** answer quality and latency depend on your hardware and the `qwen2.5:7b` / `nomic-embed-text` models; first requests may be slow while models load.
- **No telephony:** browser only — no phone calls or WebRTC.

## Docs

- Design: [docs/superpowers/specs/2026-10-12-voice-faq-assistant-design.md](docs/superpowers/specs/2026-10-12-voice-faq-assistant-design.md)
- Implementation plan: [docs/superpowers/plans/2026-10-12-voice-faq-assistant.md](docs/superpowers/plans/2026-10-12-voice-faq-assistant.md)
