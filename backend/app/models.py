from typing import Literal

from pydantic import BaseModel, Field


class StatusResponse(BaseModel):
    filename: str
    source: Literal["sample", "upload"]
    ollama_ok: bool


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    message: str
    history: list[ChatMessage] = Field(default_factory=list)


class RefusalResponse(BaseModel):
    answer: str
    refused: bool = True
