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
