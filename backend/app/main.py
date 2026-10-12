"""FastAPI app: health, status, upload, and grounded chat (SSE)."""

import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from app.answer import (
    GroundedContext,
    decide_or_refuse,
    stream_grounded_answer,
    trim_history,
)
from app.config import CORS_ORIGINS
from app.index_store import IndexStore
from app.models import ChatRequest, DocumentResponse, RefusalResponse, StatusResponse
from app.ollama_clients import get_chat, get_embeddings, ollama_ok
from app.validation import ValidationError, validate_faq_bytes

logger = logging.getLogger("echofaq")

OLLAMA_UNAVAILABLE = (
    "Ollama is unavailable. Make sure it is running and the chat and "
    "embedding models are pulled."
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    store = IndexStore(embeddings=get_embeddings())
    try:
        store.load_sample()
    except Exception:
        logger.exception(
            "Could not index the sample FAQ at startup (is Ollama running and "
            "the embedding model pulled?). /status will report ollama_ok=false."
        )
    app.state.store = store
    yield


app = FastAPI(title="EchoFAQ", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_store(request: Request) -> IndexStore:
    return request.app.state.store


def _status(store: IndexStore) -> StatusResponse:
    filename, source = store.status()
    return StatusResponse(filename=filename, source=source, ollama_ok=ollama_ok())


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.get("/status", response_model=StatusResponse)
def status(store: IndexStore = Depends(get_store)) -> StatusResponse:
    return _status(store)


@app.get("/document", response_model=DocumentResponse)
def document(store: IndexStore = Depends(get_store)) -> DocumentResponse:
    try:
        store.ensure_ready()
    except Exception:
        logger.exception("Could not load FAQ document")
        raise HTTPException(status_code=503, detail=OLLAMA_UNAVAILABLE)
    filename, source, text = store.document()
    if not text:
        raise HTTPException(status_code=503, detail="No FAQ document is loaded.")
    return DocumentResponse(filename=filename, source=source, text=text)


@app.post("/upload", response_model=StatusResponse)
def upload(
    file: UploadFile = File(...), store: IndexStore = Depends(get_store)
) -> StatusResponse:
    raw = file.file.read()
    try:
        text = validate_faq_bytes(file.filename or "", raw)
    except ValidationError as exc:
        raise HTTPException(status_code=400, detail=exc.message)
    try:
        store.replace_with_text(file.filename or "upload.txt", text, source="upload")
    except Exception:
        logger.exception("Upload indexing failed")
        raise HTTPException(status_code=503, detail=OLLAMA_UNAVAILABLE)
    return _status(store)


@app.post("/chat", response_model=None)
def chat(req: ChatRequest, store: IndexStore = Depends(get_store)):
    message = req.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="Message must not be blank.")
    history = trim_history(req.history)
    try:
        store.ensure_ready()
        decision = decide_or_refuse(store, message, history)
    except Exception:
        logger.exception("Retrieval failed")
        raise HTTPException(status_code=503, detail=OLLAMA_UNAVAILABLE)
    if isinstance(decision, RefusalResponse):
        return decision
    assert isinstance(decision, GroundedContext)
    # Fail fast (HTTP 503) before the stream starts; mid-stream failures are
    # reported as SSE `error` events by stream_grounded_answer.
    try:
        if not ollama_ok():
            raise RuntimeError("ollama unreachable")
        get_chat()
    except Exception:
        raise HTTPException(status_code=503, detail=OLLAMA_UNAVAILABLE)
    return StreamingResponse(
        stream_grounded_answer(decision), media_type="text/event-stream"
    )
