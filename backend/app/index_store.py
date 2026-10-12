"""In-memory FAISS index with an atomic, failure-safe swap."""

import threading
from typing import Literal

from langchain_community.vectorstores import FAISS
from langchain_core.embeddings import Embeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter

from app.config import CHUNK_OVERLAP, CHUNK_SIZE, SAMPLE_FAQ_PATH, TOP_K

SAMPLE_FILENAME = "sample_faq.md"

Source = Literal["sample", "upload"]


class _DuckEmbeddings(Embeddings):
    """Adapt any object with embed_documents/embed_query to LangChain's Embeddings.

    LangChain's FAISS only calls embed_query when the function is an Embeddings
    instance; otherwise it treats it as a bare callable.
    """

    def __init__(self, inner):
        self._inner = inner

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return self._inner.embed_documents(texts)

    def embed_query(self, text: str) -> list[float]:
        return self._inner.embed_query(text)


class IndexStore:
    def __init__(self, embeddings=None):
        # embeddings=None -> resolved lazily via get_embeddings() (Ollama)
        self._embeddings = embeddings
        self._lock = threading.Lock()
        self._vectorstore: FAISS | None = None
        self._filename: str = ""
        self._source: Source = "sample"

    def _get_embeddings(self):
        if self._embeddings is None:
            from app.ollama_clients import get_embeddings

            self._embeddings = get_embeddings()
        return self._embeddings

    def _build(self, text: str) -> FAISS:
        splitter = RecursiveCharacterTextSplitter(
            chunk_size=CHUNK_SIZE, chunk_overlap=CHUNK_OVERLAP
        )
        chunks = splitter.split_text(text)
        if not chunks:
            raise ValueError("No text chunks to index.")
        # normalize_L2=True: vectors are L2-normalized before indexing/search, so
        # FAISS's squared-L2 distance d relates to cosine similarity by d = 2 - 2*cos.
        emb = self._get_embeddings()
        if not isinstance(emb, Embeddings):
            emb = _DuckEmbeddings(emb)
        return FAISS.from_texts(chunks, emb, normalize_L2=True)

    def replace_with_text(
        self, filename: str, text: str, source: Source = "upload"
    ) -> None:
        # Build (and embed) outside the lock; assign only after success so a
        # failure leaves the previous index untouched.
        store = self._build(text)
        with self._lock:
            self._vectorstore = store
            self._filename = filename
            self._source = source

    def load_sample(self) -> None:
        text = SAMPLE_FAQ_PATH.read_text(encoding="utf-8")
        self.replace_with_text(SAMPLE_FILENAME, text, source="sample")

    def is_ready(self) -> bool:
        with self._lock:
            return self._vectorstore is not None

    def ensure_ready(self) -> None:
        """Make sure an index exists; retry loading the sample if startup failed.

        Raises whatever load_sample raises (e.g. Ollama unavailable).
        """
        if not self.is_ready():
            self.load_sample()

    def retrieve(self, query: str, k: int = TOP_K) -> list[tuple[str, float]]:
        with self._lock:
            store = self._vectorstore
        if store is None:
            return []
        results = store.similarity_search_with_score(query, k=k)
        out: list[tuple[str, float]] = []
        for doc, dist in results:
            # squared-L2 distance on unit vectors -> cosine, clamped to [0, 1]
            sim = 1.0 - float(dist) / 2.0
            out.append((doc.page_content, max(0.0, min(1.0, sim))))
        return out

    def status(self) -> tuple[str, Source]:
        with self._lock:
            return self._filename, self._source
