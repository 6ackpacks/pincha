"""Video Q&A chat service — handles LLM streaming logic."""

import json
import logging
from typing import AsyncGenerator

import litellm

from app.config import settings

logger = logging.getLogger(__name__)


async def stream_video_answer(
    context: str,
    question: str,
    context_type: str = "字幕文本",
) -> AsyncGenerator[str, None]:
    """Stream an LLM answer about a video based on its context.

    Yields SSE-formatted strings: "data: {...}\\n\\n" for content,
    "data: [DONE]\\n\\n" at end.
    On error, yields "event: error\\ndata: {...}\\n\\n".
    """
    system_prompt = (
        f"你是视频内容助手。根据以下视频{context_type}回答用户的问题。\n"
        "回答要简洁、准确，直接基于提供的内容。如果内容中没有相关信息，直接说明。\n\n"
        f"视频内容：\n{context[:8000]}"
    )

    try:
        resp = await litellm.acompletion(
            model=settings.SUMMARY_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": question},
            ],
            api_base=settings.SUMMARY_API_BASE,
            api_key=settings.OPENAI_API_KEY,
            stream=True,
            temperature=0.5,
        )
        async for chunk in resp:
            delta = chunk.choices[0].delta.content or ""
            if delta:
                yield "data: " + json.dumps({"delta": delta}) + "\n\n"
        yield "data: [DONE]\n\n"
    except Exception as exc:
        logger.exception("stream_video_answer error: %s", exc)
        yield "event: error\ndata: " + json.dumps({"error": True, "message": "问答出错，请稍后重试"}) + "\n\n"
