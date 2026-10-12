import json

import pytest

import app.answer as answer_mod
import app.main as main_mod
from app.config import REFUSAL_SENTENCE
from app.index_store import IndexStore
from tests.conftest import FakeEmbeddings


class Chunk:
    def __init__(self, content: str):
        self.content = content


class FakeChat:
    def __init__(self, parts=("Hello", " world"), fail_after=None):
        self.parts = parts
        self.fail_after = fail_after
        self.calls = 0

    def stream(self, messages):
        self.calls += 1
        for i, p in enumerate(self.parts):
            if self.fail_after is not None and i >= self.fail_after:
                raise RuntimeError("boom")
            yield Chunk(p)


@pytest.fixture
def chat_mock(monkeypatch):
    chat = FakeChat()
    monkeypatch.setattr(answer_mod, "get_chat", lambda: chat)
    monkeypatch.setattr(main_mod, "ollama_ok", lambda: True)
    return chat


def set_hits(monkeypatch, hits):
    monkeypatch.setattr(IndexStore, "retrieve", lambda self, q, k=3: hits)


def test_health(client):
    assert client.get("/health").json() == {"ok": True}


def test_status_reports_sample(client, monkeypatch):
    monkeypatch.setattr(main_mod, "ollama_ok", lambda: True)
    assert client.get("/status").json() == {
        "filename": "sample_faq.md",
        "source": "sample",
        "ollama_ok": True,
    }


@pytest.mark.parametrize("msg", ["", "   ", "\n\t"])
def test_blank_chat_400(client, chat_mock, msg):
    r = client.post("/chat", json={"message": msg, "history": []})
    assert r.status_code == 400
    assert chat_mock.calls == 0


def test_low_similarity_refusal_json(client, chat_mock, monkeypatch):
    set_hits(monkeypatch, [("irrelevant", 0.1)])
    r = client.post("/chat", json={"message": "weather on mars?", "history": []})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/json")
    assert r.json() == {"answer": REFUSAL_SENTENCE, "refused": True}
    assert chat_mock.calls == 0


def test_high_similarity_streams_sse(client, chat_mock, monkeypatch):
    set_hits(monkeypatch, [("Returns within 30 days.", 0.9)])
    r = client.post("/chat", json={"message": "returns?", "history": []})
    assert r.status_code == 200
    assert "text/event-stream" in r.headers["content-type"]
    assert "event: token" in r.text
    assert "event: done" in r.text
    assert chat_mock.calls == 1


def test_chat_trims_history_to_three(client, chat_mock, monkeypatch):
    seen = {}

    def fake_retrieve(self, q, k=3):
        seen["q"] = q
        return [("x", 0.9)]

    monkeypatch.setattr(IndexStore, "retrieve", fake_retrieve)
    history = [{"role": "user", "content": f"q{i}"} for i in range(6)]
    client.post("/chat", json={"message": "now", "history": history})
    assert "q2" not in seen["q"]
    assert "q3" in seen["q"] and "q5" in seen["q"]


def test_chat_503_when_ollama_down(client, chat_mock, monkeypatch):
    monkeypatch.setattr(main_mod, "ollama_ok", lambda: False)
    set_hits(monkeypatch, [("Returns within 30 days.", 0.9)])
    r = client.post("/chat", json={"message": "returns?", "history": []})
    assert r.status_code == 503
    assert "detail" in r.json()
    assert chat_mock.calls == 0


def test_chat_503_when_query_embedding_fails(client, chat_mock, monkeypatch):
    def boom(self, q, k=3):
        raise RuntimeError("embed down")

    monkeypatch.setattr(IndexStore, "retrieve", boom)
    r = client.post("/chat", json={"message": "returns?", "history": []})
    assert r.status_code == 503
    assert chat_mock.calls == 0


def test_chat_503_when_get_chat_raises_immediately(client, monkeypatch):
    monkeypatch.setattr(main_mod, "ollama_ok", lambda: True)

    def boom():
        raise RuntimeError("no model")

    monkeypatch.setattr(answer_mod, "get_chat", boom)
    monkeypatch.setattr(main_mod, "get_chat", boom)
    set_hits(monkeypatch, [("Returns within 30 days.", 0.9)])
    r = client.post("/chat", json={"message": "returns?", "history": []})
    assert r.status_code == 503


def test_midstream_failure_emits_sse_error(client, monkeypatch):
    chat = FakeChat(parts=("a", "b"), fail_after=1)
    monkeypatch.setattr(answer_mod, "get_chat", lambda: chat)
    monkeypatch.setattr(main_mod, "get_chat", lambda: chat)
    monkeypatch.setattr(main_mod, "ollama_ok", lambda: True)
    set_hits(monkeypatch, [("x", 0.9)])
    r = client.post("/chat", json={"message": "hi", "history": []})
    assert r.status_code == 200
    assert "event: token" in r.text
    assert "event: error" in r.text
    assert "event: done" not in r.text


def test_invalid_upload_pdf_400_status_unchanged(client, monkeypatch):
    monkeypatch.setattr(main_mod, "ollama_ok", lambda: True)
    r = client.post(
        "/upload", files={"file": ("notes.pdf", b"x" * 500, "application/pdf")}
    )
    assert r.status_code == 400
    assert "detail" in r.json()
    s = client.get("/status").json()
    assert s["filename"] == "sample_faq.md" and s["source"] == "sample"


def test_valid_upload_swaps_index(client, monkeypatch):
    monkeypatch.setattr(main_mod, "ollama_ok", lambda: True)
    body = ("Refunds are issued within five days of approval. " * 10).encode()
    r = client.post("/upload", files={"file": ("mine.txt", body, "text/plain")})
    assert r.status_code == 200
    assert r.json()["filename"] == "mine.txt"
    assert r.json()["source"] == "upload"
    assert client.get("/status").json()["filename"] == "mine.txt"


def test_document_returns_active_faq_text(client, monkeypatch):
    monkeypatch.setattr(main_mod, "ollama_ok", lambda: True)
    sample = client.get("/document")
    assert sample.status_code == 200
    body = sample.json()
    assert body["filename"] == "sample_faq.md"
    assert body["source"] == "sample"
    assert "30 days" in body["text"]

    uploaded = ("Refunds are issued within five days of approval. " * 10).encode()
    client.post("/upload", files={"file": ("mine.txt", uploaded, "text/plain")})
    doc = client.get("/document").json()
    assert doc["filename"] == "mine.txt"
    assert doc["source"] == "upload"
    assert "Refunds are issued" in doc["text"]


def test_upload_embed_failure_503_keeps_previous(client, store, monkeypatch):
    monkeypatch.setattr(main_mod, "ollama_ok", lambda: True)

    class Boom(FakeEmbeddings):
        def embed_documents(self, texts):
            raise RuntimeError("ollama down")

    store._embeddings = Boom()
    body = ("Refunds are issued within five days of approval. " * 10).encode()
    r = client.post("/upload", files={"file": ("mine.txt", body, "text/plain")})
    assert r.status_code == 503
    assert client.get("/status").json()["filename"] == "sample_faq.md"


def test_cors_allows_configured_origin(client):
    r = client.get("/health", headers={"Origin": "http://localhost:3002"})
    assert r.headers.get("access-control-allow-origin") == "http://localhost:3002"


def _unindexed_client(monkeypatch, embeddings):
    from fastapi.testclient import TestClient

    s = IndexStore(embeddings=embeddings)  # startup load failed -> no index
    main_mod.app.dependency_overrides[main_mod.get_store] = lambda: s
    return TestClient(main_mod.app), s


def test_chat_unindexed_retries_sample_load_then_answers(monkeypatch, chat_mock):
    c, s = _unindexed_client(monkeypatch, FakeEmbeddings())
    try:
        assert not s.is_ready()
        set_hits(monkeypatch, [("Returns within 30 days.", 0.9)])
        r = c.post("/chat", json={"message": "returns?", "history": []})
        assert r.status_code == 200
        assert s.is_ready()
        assert s.status()[0] == "sample_faq.md"
    finally:
        main_mod.app.dependency_overrides.clear()


def test_chat_unindexed_still_failing_returns_503(monkeypatch, chat_mock):
    class Boom(FakeEmbeddings):
        def embed_documents(self, texts):
            raise RuntimeError("ollama down")

    c, s = _unindexed_client(monkeypatch, Boom())
    try:
        r = c.post("/chat", json={"message": "returns?", "history": []})
        assert r.status_code == 503
        assert chat_mock.calls == 0
    finally:
        main_mod.app.dependency_overrides.clear()
