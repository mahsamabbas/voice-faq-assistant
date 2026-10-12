from unittest.mock import MagicMock

from app.answer import (
    GroundedContext,
    build_search_text,
    decide_or_refuse,
    stream_grounded_answer,
    trim_history,
)
from app.config import HISTORY_LIMIT, REFUSAL_SENTENCE
from app.models import ChatMessage, RefusalResponse


class StubStore:
    def __init__(self, hits):
        self._hits = hits
        self.queries = []

    def retrieve(self, query, k=3):
        self.queries.append(query)
        return self._hits


def test_low_similarity_refuses_without_chat(monkeypatch):
    def boom():
        raise AssertionError("chat must not be called on refusal")

    monkeypatch.setattr("app.answer.get_chat", boom)
    store = StubStore([("unrelated", 0.2)])
    result = decide_or_refuse(store, "What is the weather?", [])
    assert isinstance(result, RefusalResponse)
    assert result.answer == REFUSAL_SENTENCE
    assert result.refused is True


def test_no_hits_refuses():
    result = decide_or_refuse(StubStore([]), "anything", [])
    assert isinstance(result, RefusalResponse)


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


def test_stream_error_yields_error_frame(monkeypatch):
    class BadChat:
        def stream(self, messages):
            raise RuntimeError("ollama down")
            yield  # pragma: no cover

    monkeypatch.setattr("app.answer.get_chat", lambda: BadChat())
    ctx = GroundedContext(excerpts=["x"], message="q", history=[])
    frames = list(stream_grounded_answer(ctx))
    assert frames[0].startswith("event: meta")
    assert frames[-1].startswith("event: error")
    assert "Answer service unavailable" in frames[-1]
    assert not any(f.startswith("event: done") for f in frames)


def test_stream_skips_empty_deltas_and_sends_grounded_prompt(monkeypatch):
    seen = {}

    class FakeChat:
        def stream(self, messages):
            seen["messages"] = messages
            for part in ["", "Hi"]:
                chunk = MagicMock()
                chunk.content = part
                yield chunk

    monkeypatch.setattr("app.answer.get_chat", lambda: FakeChat())
    ctx = GroundedContext(
        excerpts=["Excerpt ONE"],
        message="q?",
        history=[ChatMessage(role="user", content="earlier")],
    )
    frames = list(stream_grounded_answer(ctx))
    assert sum(f.startswith("event: token") for f in frames) == 1
    flat = str(seen["messages"])
    assert REFUSAL_SENTENCE in flat
    assert "Excerpt ONE" in flat
    assert "earlier" in flat


def test_trim_history_keeps_latest_messages():
    hist = [
        ChatMessage(role="user" if i % 2 == 0 else "assistant", content=str(i))
        for i in range(6)
    ]
    out = trim_history(hist)
    assert [m.content for m in out] == ["3", "4", "5"]
    assert len(out) == HISTORY_LIMIT
    assert trim_history([]) == []


def test_build_search_text_includes_recent_user_context():
    hist = [
        ChatMessage(role="user", content="Tell me about returns"),
        ChatMessage(role="assistant", content="Returns within 30 days."),
    ]
    text = build_search_text("and refunds?", hist)
    assert "and refunds?" in text
    assert "Tell me about returns" in text
    assert "Returns within 30 days." not in text
    assert build_search_text("solo", []) == "solo"


def test_model_refusal_sentence_marks_done_refused(monkeypatch):
    class FakeChat:
        def stream(self, messages):
            for part in [REFUSAL_SENTENCE[:10], REFUSAL_SENTENCE[10:]]:
                chunk = MagicMock()
                chunk.content = part
                yield chunk

    monkeypatch.setattr("app.answer.get_chat", lambda: FakeChat())
    ctx = GroundedContext(excerpts=["x"], message="q?", history=[])
    frames = list(stream_grounded_answer(ctx))
    assert 'event: done\ndata: {"refused": true}' in "".join(frames)


def test_normal_answer_marks_done_not_refused(monkeypatch):
    class FakeChat:
        def stream(self, messages):
            chunk = MagicMock()
            chunk.content = "30 days."
            yield chunk

    monkeypatch.setattr("app.answer.get_chat", lambda: FakeChat())
    ctx = GroundedContext(excerpts=["x"], message="q?", history=[])
    joined = "".join(stream_grounded_answer(ctx))
    assert '"refused": false' in joined.split("event: done")[1]
