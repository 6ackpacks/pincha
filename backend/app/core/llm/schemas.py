"""LLM 请求/响应类型定义。"""
from typing import Any, Literal, TypedDict

class Message(TypedDict):
    role: Literal["system", "user", "assistant"]
    content: str

Messages = list[Message]
