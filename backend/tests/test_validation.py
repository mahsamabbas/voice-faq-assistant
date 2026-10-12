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


def test_rejects_whitespace_only():
    with pytest.raises(ValidationError):
        validate_faq_bytes("faq.txt", b" \n\t " * 100)
