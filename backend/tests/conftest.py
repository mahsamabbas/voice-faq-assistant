import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))


import pytest  # noqa: E402


class FakeEmbeddings:
    """Deterministic tiny vectors from character codes — no Ollama needed."""

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return [self._vec(t) for t in texts]

    def embed_query(self, text: str) -> list[float]:
        return self._vec(text)

    def _vec(self, text: str) -> list[float]:
        v = [0.0] * 8
        for ch in text.lower():
            if "a" <= ch <= "z":
                v[(ord(ch) - 97) % 8] += 1.0
        n = (sum(x * x for x in v) ** 0.5) or 1.0
        return [x / n for x in v]


@pytest.fixture
def store():
    from app.index_store import IndexStore

    s = IndexStore(embeddings=FakeEmbeddings())
    s.load_sample()
    return s


@pytest.fixture
def client(store):
    from fastapi.testclient import TestClient

    from app.main import app, get_store

    app.dependency_overrides[get_store] = lambda: store
    # No `with` block: lifespan (real Ollama sample load) is bypassed.
    yield TestClient(app)
    app.dependency_overrides.clear()
