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
