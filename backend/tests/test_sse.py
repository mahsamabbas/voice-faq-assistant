import json

from app.sse import format_sse


def test_format_sse_token_event():
    frame = format_sse("token", {"text": "Hello"})
    assert frame.startswith("event: token\n")
    assert "data: " in frame
    assert json.loads(frame.split("data: ", 1)[1].strip()) == {"text": "Hello"}
    assert frame.endswith("\n\n")
