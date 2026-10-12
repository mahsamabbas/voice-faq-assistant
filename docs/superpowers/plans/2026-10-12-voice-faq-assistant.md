# Voice FAQ Assistant (EchoFAQ) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Chrome voice-first FAQ demo (EchoFAQ) that answers only from one FAQ via local Ollama RAG (FAISS), streams grounded replies over SSE, and speaks them sentence-by-sentence.

**Architecture:** React (Vite) owns Web Speech STT/TTS and the Signal Desk UI. FastAPI owns validation, LangChain chunking/embeddings, in-memory FAISS, similarity cutoff, and ChatOllama streaming. Ollama runs on the host; the browser never calls the LLM.

**Tech Stack:** React 19, Vite, TypeScript, Tailwind CSS v4, Web Speech API, FastAPI, Pydantic v2, LangChain (`langchain-ollama`, `langchain-community`, `langchain-text-splitters`), FAISS (`faiss-cpu`), Ollama (`qwen2.5:7b`, `nomic-embed-text`), pytest, httpx, Vitest, Docker Compose.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-10-12-voice-faq-assistant-design.md`
- Refusal sentence (exact): `I couldn't find that in the current FAQ file.`
- Similarity cutoff default: `0.45`
- Chat model default: `qwen2.5:7b`; embed model default: `nomic-embed-text`
- Ports: frontend `3002`, API `8002`, Ollama `11434`
- Upload: `.txt`/`.md`, UTF-8, 200–12,000 characters
- History: at most 3 prior messages
- No Gemini/OpenAI; no raw excerpts in UI; no telephony/WebRTC
- Tests mock Ollama — no live network in pytest/Vitest unit tests
- Git author on commits: **mahsamabbas** `<6658043+mahsamabbas@users.noreply.github.com>`; strip any `Co-authored-by: Cursor` trailer (use `git commit-tree` if a hook re-injects it)
- Work at repo root `voice-faq-assistant/` (no nested worktree unless user asks)

## File map

| Path | Responsibility |
| --- | --- |
| `backend/app/config.py` | Env defaults, paths, cutoff, CORS origins |
| `backend/app/models.py` | Pydantic request/response models |
| `backend/app/validation.py` | FAQ upload byte validation |
| `backend/app/ollama_clients.py` | Embeddings + chat factory; `ollama_ok()` probe |
| `backend/app/index_store.py` | In-memory FAISS build/swap/retrieve + locks |
| `backend/app/answer.py` | Search text, cutoff refuse, stream grounded answer |
| `backend/app/sse.py` | SSE frame helpers |
| `backend/app/main.py` | FastAPI routes, lifespan startup index |
| `backend/data/sample_faq.md` | Bundled shop FAQ |
| `backend/tests/*` | pytest coverage |
| `frontend/src/lib/sentences.ts` | Sentence buffer for TTS |
| `frontend/src/lib/sse.ts` | SSE parser for chat stream |
| `frontend/src/lib/api.ts` | status/upload/chat client |
| `frontend/src/lib/speech.ts` | STT click-toggle + TTS queue |
| `frontend/src/App.tsx` | Signal Desk shell + state machine |
| `frontend/src/styles.css` | EchoFAQ tokens + orb motion |
| `docker-compose.yml` | frontend + backend; Ollama on host |
| `README.md` | Setup, Ollama pulls, run, tests, limits |

---

### Task 1: Backend scaffold, config, validation

**Files:**
- Create: `backend/requirements.txt`
- Create: `backend/.env.example`
- Create: `backend/app/__init__.py`
- Create: `backend/app/config.py`
- Create: `backend/app/validation.py`
- Create: `backend/tests/conftest.py`
- Create: `backend/tests/test_validation.py`
- Create: `backend/data/sample_faq.md`

**Interfaces:**
- Produces: `validate_faq_bytes(filename: str, raw: bytes) -> str` raises `ValidationError`
- Produces: config constants `MIN_CHARS=200`, `MAX_CHARS=12000`, `ALLOWED_EXTENSIONS={".txt", ".md"}`, `REFUSAL_SENTENCE`, `SIMILARITY_CUTOFF`

- [ ] **Step 1: Write `backend/requirements.txt`**

```text
fastapi>=0.115.0
uvicorn[standard]>=0.30.0
python-multipart>=0.0.9
python-dotenv>=1.0.0
pydantic>=2.0.0
langchain>=0.3.0
langchain-core>=0.3.0
langchain-community>=0.3.0
langchain-ollama>=0.2.0
langchain-text-splitters>=0.3.0
faiss-cpu>=1.8.0
httpx>=0.27.0
pytest>=8.0.0
```

- [ ] **Step 2: Write failing validation tests**

```python
# backend/tests/test_validation.py
import pytest

from app.validation import ValidationError, validate_faq_bytes


def test_rejects_empty():
    with pytest.raises(ValidationError, match="empty"):
        validate_faq_bytes("faq.md", b"")


def test_rejects_pdf_extension():
    with pytest.raises(ValidationError, match="extension"):
        validate_faq_bytes("faq.pdf", b"x" * 300)


def test_rejects_too_short():
    with pytest.raises(ValidationError, match="at least"):
        validate_faq_bytes("faq.md", b"short")


def test_accepts_valid_md():
    text = validate_faq_bytes("faq.md", ("A" * 250).encode("utf-8"))
    assert len(text) == 250
```

- [ ] **Step 3: Run tests — expect fail**

```bash
cd backend && python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
PYTHONPATH=. pytest tests/test_validation.py -v
```

Expected: FAIL (module not found or import error).

- [ ] **Step 4: Implement config + validation + sample FAQ + conftest**

```python
# backend/app/config.py
import os
from pathlib import Path

from dotenv import load_dotenv

BACKEND_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND_ROOT / ".env")

SAMPLE_FAQ_PATH = BACKEND_ROOT / "data" / "sample_faq.md"
ALLOWED_EXTENSIONS = {".txt", ".md"}
MIN_CHARS = 200
MAX_CHARS = 12_000
REFUSAL_SENTENCE = "I couldn't find that in the current FAQ file."
SIMILARITY_CUTOFF = float(os.getenv("SIMILARITY_CUTOFF", "0.45"))
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434")
OLLAMA_CHAT_MODEL = os.getenv("OLLAMA_CHAT_MODEL", "qwen2.5:7b")
OLLAMA_EMBED_MODEL = os.getenv("OLLAMA_EMBED_MODEL", "nomic-embed-text")
CORS_ORIGINS = [
    o.strip()
    for o in os.getenv(
        "CORS_ORIGINS",
        "http://localhost:3002,http://127.0.0.1:3002",
    ).split(",")
    if o.strip()
]
TOP_K = 3
CHUNK_SIZE = 400
CHUNK_OVERLAP = 40
HISTORY_LIMIT = 3
```

```python
# backend/app/validation.py
from pathlib import PurePosixPath

from app.config import ALLOWED_EXTENSIONS, MAX_CHARS, MIN_CHARS


class ValidationError(Exception):
    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(message)


def validate_faq_bytes(filename: str, raw: bytes) -> str:
    if not raw:
        raise ValidationError("File is empty.")
    suffix = PurePosixPath(filename).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise ValidationError("File extension must be .txt or .md.")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ValidationError("File must be valid UTF-8 text.") from exc
    length = len(text)
    if length < MIN_CHARS:
        raise ValidationError(f"File must be at least {MIN_CHARS} characters.")
    if length > MAX_CHARS:
        raise ValidationError(f"File must be at most {MAX_CHARS} characters.")
    return text
```

Write `backend/data/sample_faq.md` mirroring App 1 shop facts (returns 30 days, shipping 3–5 business days, tracking, Mon–Fri 9:00–17:00 ET) under a shop name distinct from BrightMart if desired (e.g. **Harbor Goods FAQ**).

```python
# backend/tests/conftest.py
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))
```

`backend/.env.example`:

```text
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_CHAT_MODEL=qwen2.5:7b
OLLAMA_EMBED_MODEL=nomic-embed-text
SIMILARITY_CUTOFF=0.45
CORS_ORIGINS=http://localhost:3002,http://127.0.0.1:3002
```

- [ ] **Step 5: Re-run validation tests — expect pass**

```bash
cd backend && source .venv/bin/activate && PYTHONPATH=. pytest tests/test_validation.py -v
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/
GIT_AUTHOR_NAME='mahsamabbas' GIT_AUTHOR_EMAIL='6658043+mahsamabbas@users.noreply.github.com' \
GIT_COMMITTER_NAME='mahsamabbas' GIT_COMMITTER_EMAIL='6658043+mahsamabbas@users.noreply.github.com' \
git commit -m "$(cat <<'EOF'
Add backend scaffold, FAQ validation, and sample FAQ.

EOF
)"
# If Co-authored-by appears, rewrite tip with commit-tree as in prior apps.
```

---

### Task 2: Pydantic models + SSE helpers

**Files:**
- Create: `backend/app/models.py`
- Create: `backend/app/sse.py`
- Create: `backend/tests/test_sse.py`

**Interfaces:**
- Produces: `StatusResponse`, `ChatMessage`, `ChatRequest`, `RefusalResponse`
- Produces: `format_sse(event: str, data: dict) -> str` returning `event: …\ndata: …\n\n`

- [ ] **Step 1: Write failing SSE test**

```python
# backend/tests/test_sse.py
import json

from app.sse import format_sse


def test_format_sse_token_event():
    frame = format_sse("token", {"text": "Hello"})
    assert frame.startswith("event: token\n")
    assert "data: " in frame
    assert json.loads(frame.split("data: ", 1)[1].strip()) == {"text": "Hello"}
    assert frame.endswith("\n\n")
```

- [ ] **Step 2: Run — expect fail**

```bash
cd backend && source .venv/bin/activate && PYTHONPATH=. pytest tests/test_sse.py -v
```

Expected: FAIL import error.

- [ ] **Step 3: Implement models + sse**

```python
# backend/app/models.py
from typing import Literal

from pydantic import BaseModel, Field


class StatusResponse(BaseModel):
    filename: str
    source: Literal["sample", "upload"]
    ollama_ok: bool


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    message: str
    history: list[ChatMessage] = Field(default_factory=list)


class RefusalResponse(BaseModel):
    answer: str
    refused: bool = True
```

```python
# backend/app/sse.py
import json
from typing import Any


def format_sse(event: str, data: dict[str, Any]) -> str:
    payload = json.dumps(data, ensure_ascii=False)
    return f"event: {event}\ndata: {payload}\n\n"
```

- [ ] **Step 4: Run SSE test — expect pass**

```bash
PYTHONPATH=. pytest tests/test_sse.py -v
```

- [ ] **Step 5: Commit**

```bash
git add backend/app/models.py backend/app/sse.py backend/tests/test_sse.py
# commit as mahsamabbas: "Add chat models and SSE frame helper."
```

---

### Task 3: Index store (FAISS) with mocked embeddings

**Files:**
- Create: `backend/app/ollama_clients.py`
- Create: `backend/app/index_store.py`
- Create: `backend/tests/test_index_store.py`

**Interfaces:**
- Produces: `get_embeddings()` → LangChain embeddings object (mockable)
- Produces: `ollama_ok() -> bool`
- Produces: `IndexStore` with:
  - `load_sample() -> None`
  - `replace_with_text(filename: str, text: str) -> None`
  - `retrieve(query: str, k: int = 3) -> list[tuple[str, float]]`  # (chunk, similarity 0..1)
  - `status() -> tuple[str, Literal["sample","upload"]]`  # filename, source
  - thread lock around swap

- [ ] **Step 1: Write failing index tests (mock embeddings as identity-ish vectors)**

```python
# backend/tests/test_index_store.py
from unittest.mock import MagicMock

import numpy as np
import pytest

from app.index_store import IndexStore


class FakeEmbeddings:
    """Deterministic tiny vectors from character codes — enough for unit tests."""

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return [self._vec(t) for t in texts]

    def embed_query(self, text: str) -> list[float]:
        return self._vec(text)

    def _vec(self, text: str) -> list[float]:
        # 8-dim bag from lowercase letters
        v = [0.0] * 8
        for ch in text.lower():
            if "a" <= ch <= "z":
                v[(ord(ch) - 97) % 8] += 1.0
        n = (sum(x * x for x in v) ** 0.5) or 1.0
        return [x / n for x in v]


def test_retrieve_returns_bounded_similarity(monkeypatch):
    store = IndexStore(embeddings=FakeEmbeddings())
    store.replace_with_text(
        "sample.md",
        "Returns are accepted within 30 days of delivery. " * 20,
    )
    hits = store.retrieve("30 days returns", k=3)
    assert hits
    for _text, score in hits:
        assert 0.0 <= score <= 1.0


def test_replace_keeps_previous_on_embed_failure(monkeypatch):
    store = IndexStore(embeddings=FakeEmbeddings())
    store.replace_with_text("ok.md", ("Good FAQ content about shipping times. " * 20))
    name_before, source_before = store.status()

    class Boom(FakeEmbeddings):
        def embed_documents(self, texts):
            raise RuntimeError("ollama down")

    store._embeddings = Boom()
    with pytest.raises(RuntimeError):
        store.replace_with_text("bad.md", ("Another valid length FAQ about returns. " * 20))
    name_after, source_after = store.status()
    assert name_after == name_before
    assert source_after == source_before
```

- [ ] **Step 2: Run — expect fail**

```bash
PYTHONPATH=. pytest tests/test_index_store.py -v
```

- [ ] **Step 3: Implement ollama_clients + index_store**

`ollama_clients.py`: thin wrappers —

```python
def get_embeddings():
    from langchain_ollama import OllamaEmbeddings
    from app.config import OLLAMA_BASE_URL, OLLAMA_EMBED_MODEL
    return OllamaEmbeddings(model=OLLAMA_EMBED_MODEL, base_url=OLLAMA_BASE_URL)

def get_chat():
    from langchain_ollama import ChatOllama
    from app.config import OLLAMA_BASE_URL, OLLAMA_CHAT_MODEL
    return ChatOllama(model=OLLAMA_CHAT_MODEL, base_url=OLLAMA_BASE_URL, temperature=0)

def ollama_ok() -> bool:
    import httpx
    from app.config import OLLAMA_BASE_URL
    try:
        r = httpx.get(f"{OLLAMA_BASE_URL}/api/tags", timeout=2.0)
        return r.status_code == 200
    except Exception:
        return False
```

`index_store.py` sketch (implement fully in code):

- Hold `_lock`, `_vectorstore`, `_chunks` optional, `_filename`, `_source`
- `replace_with_text`: split with `RecursiveCharacterTextSplitter(chunk_size=CHUNK_SIZE, chunk_overlap=CHUNK_OVERLAP)`, `FAISS.from_texts(..., embeddings)`, **normalize** for cosine; only assign to active store after success
- `retrieve`: `similarity_search_with_relevance_scores` (or distance → `similarity = 1 - distance` clamped); return top-k `(page_content, score)`
- `load_sample`: read `SAMPLE_FAQ_PATH`, `replace_with_text("sample_faq.md", text)` then set source `"sample"`

If LangChain relevance scores are not cosine 0–1, document the mapping in code comments and clamp to `[0, 1]`.

- [ ] **Step 4: Run index tests — expect pass**

```bash
PYTHONPATH=. pytest tests/test_index_store.py -v
```

- [ ] **Step 5: Commit** — `Add in-memory FAISS index store with safe swap.`

---

### Task 4: Answer path (cutoff + stream)

**Files:**
- Create: `backend/app/answer.py`
- Create: `backend/tests/test_answer.py`

**Interfaces:**
- Consumes: `IndexStore.retrieve`, `REFUSAL_SENTENCE`, `SIMILARITY_CUTOFF`, `HISTORY_LIMIT`, `get_chat`
- Produces:
  - `trim_history(history: list[ChatMessage]) -> list[ChatMessage]`
  - `build_search_text(message: str, history: list[ChatMessage]) -> str`
  - `decide_or_refuse(store, message, history) -> RefusalResponse | GroundedContext`
  - `GroundedContext(excerpts: list[str], message: str, history: list[ChatMessage])`
  - `stream_grounded_answer(ctx: GroundedContext)` → iterator yielding SSE strings (`meta`, `token`, `done` / `error`)

- [ ] **Step 1: Write failing answer tests**

```python
# backend/tests/test_answer.py
from unittest.mock import MagicMock

from app.answer import decide_or_refuse, stream_grounded_answer
from app.config import REFUSAL_SENTENCE
from app.models import ChatMessage, RefusalResponse


class StubStore:
    def __init__(self, hits):
        self._hits = hits
        self.chat_called = False

    def retrieve(self, query, k=3):
        return self._hits


def test_low_similarity_refuses_without_chat(monkeypatch):
    store = StubStore([("unrelated", 0.2)])
    result = decide_or_refuse(store, "What is the weather?", [])
    assert isinstance(result, RefusalResponse)
    assert result.answer == REFUSAL_SENTENCE
    assert result.refused is True


def test_high_similarity_streams_tokens(monkeypatch):
    store = StubStore([("Returns within 30 days.", 0.9)])

    class FakeChat:
        def stream(self, messages):
            for part in ["Returns ", "are accepted ", "within 30 days."]:
                chunk = MagicMock()
                chunk.content = part
                yield chunk

    monkeypatch.setattr("app.answer.get_chat", lambda: FakeChat())
    ctx = decide_or_refuse(store, "What is the return window?", [])
    assert not isinstance(ctx, RefusalResponse)
    frames = list(stream_grounded_answer(ctx))
    joined = "".join(frames)
    assert "event: meta" in joined
    assert "event: token" in joined
    assert "event: done" in joined
    assert "30 days" in joined
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement `answer.py`**

Prompt rules (system): answer only from excerpts; if unsupported, reply with exactly `REFUSAL_SENTENCE`; do not invent policies.

`stream_grounded_answer`:
1. yield `format_sse("meta", {"refused": False})`
2. call `get_chat().stream(...)` yielding content deltas as `format_sse("token", {"text": delta})`
3. yield `format_sse("done", {"refused": False})`
4. on exception: yield `format_sse("error", {"detail": "Answer service unavailable"})`

Blank message handling stays in the route (400), not here.

- [ ] **Step 4: Run answer tests — expect pass**

- [ ] **Step 5: Commit** — `Add grounded answer path with cutoff and SSE stream.`

---

### Task 5: FastAPI routes (status, health, upload, chat)

**Files:**
- Create: `backend/app/main.py`
- Create: `backend/tests/test_api.py`
- Modify: `backend/tests/conftest.py` (shared TestClient fixture with mocked store/embeddings)

**Interfaces:**
- Produces HTTP API per spec
- Lifespan: build `IndexStore` with real `get_embeddings()` in production; tests inject FakeEmbeddings / StubStore via app dependency overrides

- [ ] **Step 1: Write failing API tests**

Cover at minimum:

1. Blank chat → 400  
2. Low similarity → 200 JSON refusal; assert chat mock not called  
3. High similarity → `content-type` contains `text/event-stream`; body contains `event: token`  
4. Invalid upload `.pdf` → 400; `/status` still sample  
5. Ollama/chat failure → 503 or SSE `error` (pick one consistent with implementation; prefer 503 before stream starts if `get_chat` raises immediately)

Use `fastapi.testclient.TestClient` and monkeypatch `IndexStore.retrieve` / `get_chat` / `ollama_ok`.

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement `main.py`**

Routes:

- `GET /health` → `{"ok": true}`
- `GET /status` → `StatusResponse` from store + `ollama_ok()`
- `POST /upload` → validate → `replace_with_text` → status; `ValidationError` → 400; embed errors → 503
- `POST /chat` → trim history; blank → 400; `decide_or_refuse`; if `RefusalResponse` return JSON; else `StreamingResponse(stream_grounded_answer(ctx), media_type="text/event-stream")`

CORSMiddleware with `CORS_ORIGINS`.

Lifespan startup: `store.load_sample()` — if Ollama missing at startup, log clearly; tests bypass with fake embeddings so CI does not need Ollama.

- [ ] **Step 4: Run full backend suite**

```bash
cd backend && source .venv/bin/activate && PYTHONPATH=. pytest -v
```

Expected: all PASS

- [ ] **Step 5: Commit** — `Wire FastAPI status, upload, and chat SSE routes.`

---

### Task 6: Frontend scaffold + Signal Desk shell

**Files:**
- Create: Vite React-TS app under `frontend/` (npm create)
- Create: `frontend/.env.example` with `VITE_API_BASE=http://localhost:8002`
- Create: `frontend/src/styles.css` (EchoFAQ tokens, fonts Syne + Manrope via Google Fonts import)
- Create: `frontend/src/App.tsx` static shell (brand, orb, ribbon placeholder, utility rail)
- Create: `frontend/src/main.tsx`
- Create: `frontend/index.html` title EchoFAQ
- Modify: `frontend/vite.config.ts` port `3002`

**Interfaces:**
- Produces runnable UI at `http://localhost:3002` without API yet

- [ ] **Step 1: Scaffold**

```bash
cd /Users/azc/Desktop/azc/mahsamabbas_repos/voice-faq-assistant
npm create vite@latest frontend -- --template react-ts
cd frontend && npm install && npm install -D tailwindcss @tailwindcss/vite vitest jsdom @testing-library/react @testing-library/jest-dom
```

Wire Tailwind v4 in `vite.config.ts` (`tailwindcss()` plugin) and port 3002.

- [ ] **Step 2: Implement Signal Desk visual shell (no speech yet)**

CSS variables:

```css
:root {
  --bg0: #e8eef2;
  --bg1: #dfead8;
  --ink: #1a2228;
  --lime: #7cff6b;
  --mute: #5a6a74;
  --font-display: "Syne", sans-serif;
  --font-ui: "Manrope", sans-serif;
}
```

Layout: hero **EchoFAQ** wordmark; center orb button; status line; empty transcript ribbon; bottom rail with Mute, Upload, text input stubs.

Orb CSS classes for states: `.orb`, `.orb.listening`, `.orb.thinking`, `.orb.speaking` (waveform ring / pulse).

- [ ] **Step 3: Manual check**

```bash
cd frontend && npm run dev
```

Expected: page loads on 3002 with EchoFAQ branding (not looking like App 1/2).

- [ ] **Step 4: Commit** — `Scaffold EchoFAQ Signal Desk frontend shell.`

---

### Task 7: Sentence buffer + SSE parser (Vitest)

**Files:**
- Create: `frontend/src/lib/sentences.ts`
- Create: `frontend/src/lib/sse.ts`
- Create: `frontend/src/lib/sentences.test.ts`
- Create: `frontend/src/lib/sse.test.ts`
- Create: `frontend/vitest.config.ts`

**Interfaces:**
- Produces: `pullSentences(buffer: string): { sentences: string[]; rest: string }`
- Produces: `parseSseBlock(block: string): { event: string; data: unknown } | null`
- Produces: `consumeSseBuffer(buffer: string): { events: Array<{event: string; data: unknown}>; rest: string }`

- [ ] **Step 1: Write failing Vitest tests**

```ts
// sentences.test.ts
import { describe, expect, it } from "vitest";
import { pullSentences } from "./sentences";

describe("pullSentences", () => {
  it("emits complete sentences and keeps remainder", () => {
    const r = pullSentences("Hello there. More");
    expect(r.sentences).toEqual(["Hello there."]);
    expect(r.rest).toBe(" More");
  });

  it("keeps unfinished text", () => {
    const r = pullSentences("Hello");
    expect(r.sentences).toEqual([]);
    expect(r.rest).toBe("Hello");
  });
});
```

```ts
// sse.test.ts
import { describe, expect, it } from "vitest";
import { consumeSseBuffer } from "./sse";

describe("consumeSseBuffer", () => {
  it("parses one token event", () => {
    const raw = 'event: token\ndata: {"text":"Hi"}\n\n';
    const { events, rest } = consumeSseBuffer(raw);
    expect(rest).toBe("");
    expect(events[0]).toEqual({ event: "token", data: { text: "Hi" } });
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
cd frontend && npx vitest run
```

- [ ] **Step 3: Implement helpers**

`pullSentences`: regex split on `(?<=[.!?])\s+` while retaining delimiter on sentence; do not emit trailing incomplete fragment.

`consumeSseBuffer`: split on `\n\n`, parse `event:` and `data:` lines, `JSON.parse` data.

- [ ] **Step 4: Run Vitest — expect pass**

- [ ] **Step 5: Commit** — `Add sentence buffer and SSE parser with Vitest.`

---

### Task 8: API client + speech helpers + App wiring

**Files:**
- Create: `frontend/src/lib/api.ts`
- Create: `frontend/src/lib/speech.ts`
- Modify: `frontend/src/App.tsx` (full state machine)

**Interfaces:**
- Produces: `getStatus()`, `uploadFaq(file: File)`, `sendChat(message, history, handlers)`
  - `sendChat` uses `fetch`; if `content-type` is JSON, parse refusal; if SSE, stream via `ReadableStream` + `consumeSseBuffer`
- Produces speech:
  - `speechSupported(): boolean`
  - `createRecognizer(onPartial, onFinal, onError)`
  - `speakSentences(sentences: string[], muted: boolean)`
  - `cancelSpeech()`
- App state: `idle | listening | thinking | speaking`
- History: keep last turns for API (≤3 messages sent)
- Mic click-toggle: start recognition ↔ stop and submit final transcript
- Mute toggle; upload clears transcript on success
- Labels: From FAQ if `!refused`, Not in FAQ if refused
- Chrome banner when `!speechSupported()`

- [ ] **Step 1: Implement `api.ts` and `speech.ts` with clear exported functions (no network in unit tests required beyond existing Vitest)**

`sendChat` handler callbacks: `onToken(text)`, `onDone(refused)`, `onRefusal(answer)`, `onError(message)`.

- [ ] **Step 2: Wire App.tsx**

On token: append to assistant bubble; `pullSentences` on buffer; `speakSentences` for completed ones unless muted. On done: flush rest buffer to TTS. On refusal JSON: show bubble + speak refusal unless muted. New listening session calls `cancelSpeech()`.

- [ ] **Step 3: Manual integration** (Ollama must be running)

```bash
# terminal A
cd backend && source .venv/bin/activate && uvicorn app.main:app --reload --port 8002
# terminal B
cd frontend && npm run dev
```

Smoke: type “What is your return window?” → stream + speak; type “Who won the World Cup?” → refusal.

- [ ] **Step 4: Commit** — `Wire voice/typed chat client with streaming TTS.`

---

### Task 9: Docker Compose + README + root env example

**Files:**
- Create: `backend/Dockerfile`
- Create: `frontend/Dockerfile`
- Create: `docker-compose.yml`
- Create: `.env.example` (root pointers)
- Create: `README.md`
- Create: `frontend/nginx.conf` or Vite preview serve — prefer Node serve of `vite build` with simple static server, or nginx; match App 2 simplicity if possible
- Modify: backend Dockerfile CMD uvicorn `:8000` inside container; compose maps `8002:8000`
- Compose: set `OLLAMA_BASE_URL=http://host.docker.internal:11434` for backend

- [ ] **Step 1: Write Dockerfiles + compose**

`docker-compose.yml` services `backend` and `frontend`; frontend env `VITE_API_BASE` baked at build to `http://localhost:8002` for browser calls (browser → host port, not docker DNS).

- [ ] **Step 2: Write README** covering:

- What EchoFAQ is
- Ollama install + `ollama pull qwen2.5:7b` + `ollama pull nomic-embed-text`
- Docker + local run
- Ports 3002/8002
- Tests commands
- Limitations (in-memory index, Chrome voice, local models)
- Link to design + plan

- [ ] **Step 3: Verify**

```bash
cd backend && PYTHONPATH=. pytest -v
cd frontend && npx vitest run
# optional: docker compose up --build (Docker Desktop + Ollama running)
```

- [ ] **Step 4: Commit** — `Add Docker Compose and README for EchoFAQ.`

---

### Task 10: Polish pass + final verification

**Files:**
- Modify: `frontend/src/styles.css`, `App.tsx` as needed for motion polish
- Modify: README if any setup friction found

- [ ] **Step 1: Checklist against spec**

- [ ] Voice click-toggle + typed backup  
- [ ] Auto-speak + Mute  
- [ ] Sentence-streamed TTS  
- [ ] Upload replace + clear transcript  
- [ ] Refusal exact sentence  
- [ ] EchoFAQ Signal Desk look (not App 1/2)  
- [ ] pytest + vitest green with mocks  

- [ ] **Step 2: Final commit if polish landed** — `Polish EchoFAQ voice UX and verify demo flow.`

---

## Self-review (plan vs spec)

| Spec requirement | Task |
| --- | --- |
| Voice primary + typed backup, click-toggle | 8 |
| Sample + upload FAQ rules | 1, 5 |
| en-US Web Speech, Mute, interrupt | 8 |
| Bubbles + From FAQ / Not in FAQ, no excerpts | 8 |
| History ≤3 | 4, 5, 8 |
| FAISS + LangChain + Ollama models | 3, 4 |
| SSE stream + sentence TTS | 2, 4, 5, 7, 8 |
| Signal Desk EchoFAQ UI | 6, 8, 10 |
| Cutoff 0.45 + fixed refusal | 1, 4, 5 |
| Errors 400/503 / SSE error | 5 |
| pytest mocked Ollama | 3, 4, 5 |
| Vitest sentence/SSE | 7 |
| Docker + README + ports 3002/8002 | 9 |
| No Gemini/telephony | Global + out of scope |

No TBD placeholders in tasks. Types aligned: `RefusalResponse`, `format_sse`, `pullSentences`, `consumeSseBuffer`, `IndexStore.retrieve → list[tuple[str,float]]`.
