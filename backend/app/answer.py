"""Grounded answer path: similarity cutoff, refusal, and SSE token streaming."""

from collections.abc import Iterator
from dataclasses import dataclass, field

from app.config import (
    HISTORY_LIMIT,
    REFUSAL_SENTENCE,
    SIMILARITY_CUTOFF,
    TOP_K,
)
from app.models import ChatMessage, RefusalResponse
from app.ollama_clients import get_chat
from app.sse import format_sse

SYSTEM_PROMPT = (
    "You are EchoFAQ, an assistant that answers strictly from the FAQ excerpts "
    "provided below.\n"
    "Rules:\n"
    "- Answer only using the excerpts. Do not use outside knowledge.\n"
    "- Do not invent policies, numbers, dates, or details that are not in the excerpts.\n"
    f"- If the excerpts do not support an answer, reply with exactly: {REFUSAL_SENTENCE}\n"
    "- Keep answers short and suitable for being read aloud."
)


@dataclass
class GroundedContext:
    excerpts: list[str]
    message: str
    history: list[ChatMessage] = field(default_factory=list)


def trim_history(history: list[ChatMessage]) -> list[ChatMessage]:
    """Keep only the latest HISTORY_LIMIT messages."""
    if HISTORY_LIMIT <= 0:
        return []
    return list(history[-HISTORY_LIMIT:])


def build_search_text(message: str, history: list[ChatMessage]) -> str:
    """Retrieval query: recent user turns (for follow-ups) plus the new message."""
    prior_user = [m.content for m in trim_history(history) if m.role == "user"]
    return "\n".join([*prior_user, message])


def decide_or_refuse(
    store, message: str, history: list[ChatMessage]
) -> RefusalResponse | GroundedContext:
    trimmed = trim_history(history)
    hits = store.retrieve(build_search_text(message, trimmed), k=TOP_K)
    grounded = [(text, score) for text, score in hits if score >= SIMILARITY_CUTOFF]
    if not grounded:
        return RefusalResponse(answer=REFUSAL_SENTENCE, refused=True)
    return GroundedContext(
        excerpts=[text for text, _ in grounded], message=message, history=trimmed
    )


def _build_messages(ctx: GroundedContext) -> list[tuple[str, str]]:
    excerpts = "\n\n".join(f"[{i}] {t}" for i, t in enumerate(ctx.excerpts, start=1))
    messages: list[tuple[str, str]] = [
        ("system", f"{SYSTEM_PROMPT}\n\nFAQ excerpts:\n{excerpts}")
    ]
    for m in ctx.history:
        messages.append(("human" if m.role == "user" else "ai", m.content))
    messages.append(("human", ctx.message))
    return messages


def stream_grounded_answer(ctx: GroundedContext) -> Iterator[str]:
    yield format_sse("meta", {"refused": False})
    parts: list[str] = []
    try:
        for chunk in get_chat().stream(_build_messages(ctx)):
            delta = chunk.content
            if isinstance(delta, str) and delta:
                parts.append(delta)
                yield format_sse("token", {"text": delta})
    except Exception:
        yield format_sse("error", {"detail": "Answer service unavailable"})
        return
    # The model may itself decline (per the system prompt); label that as refused.
    full = "".join(parts).strip()
    refused = bool(full) and full.startswith(REFUSAL_SENTENCE)
    yield format_sse("done", {"refused": refused})
