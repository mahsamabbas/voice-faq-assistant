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


def test_retrieve_returns_bounded_similarity():
    store = IndexStore(embeddings=FakeEmbeddings())
    store.replace_with_text(
        "sample.md",
        "Returns are accepted within 30 days of delivery. " * 20,
    )
    hits = store.retrieve("30 days returns", k=3)
    assert hits
    assert len(hits) <= 3
    for _text, score in hits:
        assert 0.0 <= score <= 1.0


def test_retrieve_identical_text_scores_near_one():
    store = IndexStore(embeddings=FakeEmbeddings())
    store.replace_with_text("a.md", "Shipping takes five business days. " * 20)
    hits = store.retrieve("Shipping takes five business days.", k=1)
    assert hits[0][1] > 0.95


def test_retrieve_before_load_returns_empty():
    store = IndexStore(embeddings=FakeEmbeddings())
    assert store.retrieve("anything") == []


def test_replace_sets_upload_status():
    store = IndexStore(embeddings=FakeEmbeddings())
    store.replace_with_text("mine.txt", "Upload content about refunds. " * 20)
    assert store.status() == ("mine.txt", "upload")


def test_load_sample_sets_sample_status():
    store = IndexStore(embeddings=FakeEmbeddings())
    store.load_sample()
    assert store.status() == ("sample_faq.md", "sample")
    assert store.retrieve("returns", k=3)


def test_replace_keeps_previous_on_embed_failure():
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

    # old index still serves queries
    store._embeddings = FakeEmbeddings()
    assert store.retrieve("shipping times", k=1)
