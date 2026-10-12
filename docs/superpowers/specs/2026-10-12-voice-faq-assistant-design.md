# Voice FAQ Assistant (EchoFAQ)

Design for App 3. Browser-based, turn-by-turn voice FAQ assistant: listen (or type), answer only from one FAQ file via local RAG, stream the reply, and speak it sentence-by-sentence. One supported browser (Chrome). No phone calls, telephony, or WebRTC.

## Decisions

- **Interaction:** Voice primary with typed backup. Push-to-talk via **click-toggle** (click mic to start listening, click again to stop and send) for reliable desktop demos.
- **FAQ source:** Bundled sample FAQ plus optional `.txt` / `.md` upload that replaces the active index. No upload-time “is this an FAQ?” LLM check.
- **Speech:** Web Speech API, `en-US` only. Auto-speak every answer including refusals, with a Mute toggle. New mic press stops TTS for the current turn.
- **On screen:** Heard question and answer as text bubbles, plus “From FAQ” / “Not in FAQ” labels. No raw source excerpts in the UI.
- **Memory:** Last 2–3 turns sent with each question. Answers still come only from the current FAQ.
- **Approach:** Voice shell + grounded FAISS RAG (Approach 1). React (Vite) frontend; FastAPI backend; browser never calls the LLM.
- **Models (local Ollama):** Chat `qwen2.5:7b`; embeddings `nomic-embed-text`. Wired through LangChain. Env-overridable. No Gemini/OpenAI for this app.
- **Streaming:** Successful grounded answers stream over SSE (token events). UI types the answer live; TTS speaks **completed sentences** as they form (not per-token). Low-similarity refusals stay a single JSON response (no stream).
- **Frontend identity:** Unique “Signal Desk” UI branded **EchoFAQ** — not a copy of App 1 or App 2 chat layouts.

## Architecture

Three runtime pieces on the developer machine:

1. **Chrome + React (Vite) + Tailwind** — EchoFAQ Signal Desk UI, Web Speech STT/TTS, SSE client, upload control. Ports default **3002**.
2. **FastAPI** — validation, chunking, LangChain embeddings + FAISS index, retrieval cutoff, Ollama chat (stream or refuse). Ports default **8002**.
3. **Ollama on the host** (`http://127.0.0.1:11434`) — `qwen2.5:7b` and `nomic-embed-text`. Dockerized API reaches Ollama via `host.docker.internal` (or `OLLAMA_BASE_URL`).

```
[Chrome / EchoFAQ]
  push-to-talk STT · typed backup · SSE render · sentence TTS · Mute · upload
        │ HTTP only
        ▼
[FastAPI :8002]
  validate → FAISS retrieve → cutoff → ChatOllama stream or refuse
        │
        ▼
[Ollama :11434]
  nomic-embed-text · qwen2.5:7b
```

Unsupported browser: show a clear banner that voice needs Chrome; typed questions and streamed answers still work if the Speech API is missing.

## Frontend — Signal Desk (EchoFAQ)

**Concept:** One full-viewport composition centered on a **live signal orb** (the mic), not a chat-app clone with a mic bolted on.

| Token | Choice |
| --- | --- |
| Brand | **EchoFAQ** as hero-level wordmark |
| Canvas | Cool mist `#E8EEF2` with a soft lime wash (light, atmospheric — not flat white, not dark-first) |
| Accent | Electric lime `#7CFF6B` on graphite `#1A2228` |
| Type | Display **Syne**; UI **Manrope** |
| Layout | Brand top · orb center · transcript ribbon below · thin utility rail (upload, mute, typed field) |

**Motion (required):**

1. **Listening** — soft waveform ring on the orb.
2. **Thinking** — slow pulse + status “Thinking…”.
3. **Speaking** — answer text appears as tokens stream; orb indicates speaking while sentence TTS runs.

**Anti-copy rules:** No App 1 teal/coral bubble chrome; no App 2 lead sidebar; no shadcn card grid as the main structure; no purple gradient theme; no cream/terracotta serif look.

**Transcript ribbon:** Scrollable user/assistant bubbles under the orb with From FAQ / Not in FAQ. Typed input is a slim fallback under the ribbon.

## Components

**Voice screen.** Orb mic, status line (Idle / Listening / Thinking / Speaking), Mute, upload, active FAQ name from `GET /status`, transcript ribbon, typed composer.

**Speech (browser only).** Recognition and synthesis via Web Speech, `en-US`. Final transcript (or typed text) becomes `message` for `POST /chat`. Mute skips `speechSynthesis`. Interrupt: starting a new listen cancels ongoing TTS.

**File rules.** Accept `.txt` and `.md` only. UTF-8. Reject empty, under 200 characters, or over 12,000 characters. Failures return 400 and leave the current index unchanged.

**Index.** One in-memory FAISS index via LangChain. Startup loads `backend/data/sample_faq.md`, chunks (≈400 size / ≈40 overlap), embeds with `nomic-embed-text`. A valid upload builds a replacement index, then swaps atomically. API restart drops uploads and reloads the sample.

**Answer.** Build search text from the new question plus at most three prior messages. Retrieve top three chunks. Cosine similarity in \([0, 1]\). If best score **&lt; 0.45**, do not call the chat model; return the fixed refusal. Otherwise stream a chat completion from `qwen2.5:7b` instructed to answer only from the excerpts; the model may still refuse (treat as refused when the model emits the refusal sentence or an explicit refuse signal — prefer prompting it to output the fixed refusal sentence when unsupported).

**Fixed refusal sentence:** `I couldn't find that in the current FAQ file.`

**Sample FAQ.** Short English shop FAQ covering shipping, returns, order tracking, and hours (same spirit as App 1: e.g. 30-day returns, 3–5 business day shipping, Mon–Fri 9:00–17:00).

## Data flow

**Startup.** Index sample FAQ into FAISS. `GET /status` reports sample filename and whether Ollama is reachable.

**Upload.** Browser sends multipart file. Rule failures → 400. Embed failures / Ollama down → 503, previous index kept. Success → swap index, return new status; UI clears the transcript.

**Question.**

1. Blank message → 400.
2. Best similarity &lt; 0.45 → `200` JSON `{ "answer": "<refusal>", "refused": true }` (no SSE, chat model not called).
3. Otherwise → `text/event-stream`:
   - `event: meta` — `{ "refused": false }`
   - `event: token` — `{ "text": "..." }` (one or more)
   - `event: done` — `{ "refused": false }`
   - On failure mid-stream → `event: error` — `{ "detail": "..." }`; UI stops Speaking and shows the error.
4. Missing models / Ollama unreachable when chat or embed is required → 503, no invented answer.

**Frontend stream UX.** Append tokens to the assistant bubble. Maintain a buffer; when a sentence boundary (`.`, `?`, `!`) completes, queue that sentence on `speechSynthesis` unless muted. After `done`, flush any remaining buffer as a final utterance.

**Restart.** Memory index empty; next startup reloads sample FAQ.

## API

- `GET /status` → `{ "filename": string, "source": "sample" | "upload", "ollama_ok": boolean }`
- `GET /health` → liveness; may include Ollama check
- `POST /upload` → multipart field `file`. Success returns status. 400 validation / 503 embed or Ollama
- `POST /chat` → body `{ "message": string, "history": [{ "role": "user" | "assistant", "content": string }] }`. History trimmed to the latest three messages. Response is either refusal JSON or SSE as above.

### Config (`.env` / `.env.example`)

- `OLLAMA_BASE_URL` (default `http://127.0.0.1:11434`)
- `OLLAMA_CHAT_MODEL` (default `qwen2.5:7b`)
- `OLLAMA_EMBED_MODEL` (default `nomic-embed-text`)
- `SIMILARITY_CUTOFF` (default `0.45`)
- CORS for the Vite origin

No cloud API keys required for the core demo. Secrets never committed; parent `.github_key` stays outside this repo.

## Error handling

| Case | Result | Index |
| --- | --- | --- |
| Wrong extension, empty, &lt;200 or &gt;12,000 chars, not UTF-8 | 400 + reason | Unchanged |
| Blank question | 400 | Unchanged |
| Best similarity &lt; 0.45 | 200 refused JSON | Unchanged |
| Excerpts retrieved but unsupported | Refusal (JSON or short stream ending in refusal sentence) | Unchanged |
| Ollama down / model not pulled | 503 with actionable detail | Unchanged |
| Mid-stream Ollama failure | SSE `error` | Unchanged |
| Mic permission denied | UI tip; typed backup | Unchanged |
| Speech API missing | Chrome banner; typed + stream OK | Unchanged |
| API process restart | Next status shows sample | Sample reloaded |

The app does not invent policies, fees, dates, or other facts missing from the FAQ.

## Testing

**Backend (pytest).** Ollama chat and embeddings mocked; tests do not call the network or a real Ollama process.

- Normal: retriever returns a high-similarity excerpt; mocked stream yields grounded tokens; assembled answer is not the refusal sentence; `refused` is false.
- Not in file: similarity below cutoff; chat model not called; fixed refusal JSON.
- Blank message: 400; model not called.
- Invalid upload: 400; later `/status` still reports previous file.
- Ollama unavailable on chat: 503; body does not contain a made-up FAQ answer.

**Frontend (Vitest, light).** Unit-test sentence buffering helper and SSE event parsing. No requirement for full browser Speech E2E in CI.

## Out of scope

Phone calls, telephony, WebRTC, continuous always-on listening, WhatsApp, multi-file libraries, disk-persisted vector index, cloud LLMs (Gemini/OpenAI), showing raw excerpts in the UI, accounts, CRM, and any write into a live business system.

## Prerequisites (developer machine)

- Apple Silicon Mac with enough RAM for `qwen2.5:7b` + `nomic-embed-text` (target: M4 Pro 24 GB class)
- Ollama installed; models pulled:
  - `ollama pull qwen2.5:7b`
  - `ollama pull nomic-embed-text`
- Chrome for voice demos

## Repo layout

```
voice-faq-assistant/
  backend/                 FastAPI, LangChain, FAISS, sample FAQ, pytest
  frontend/                React (Vite), TypeScript, Tailwind, Web Speech
  docs/superpowers/specs/  this design
  docker-compose.yml       frontend + backend; Ollama on host
  README.md
  .env.example
```

## Deviation from portfolio stack note

`app-tech-stacks.md` lists Gemini for every app. App 3 intentionally uses **local Ollama** (chat + embeddings) via LangChain so demos do not depend on cloud quota. Stack otherwise matches: React (Vite), TypeScript, Tailwind, FastAPI, FAISS, Web Speech.
