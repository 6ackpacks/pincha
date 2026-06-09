"""Fast summary 生成服务测试.

测试 generate_and_store_fast_summaries 函数的核心逻辑：
- 生成 3 个级别（detailed + highlight + express）
- 正确存入数据库
- 空字幕处理
- 部分失败处理
"""

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.models.video import Video
from app.services.summary_service import (
    generate_and_store_fast_summaries,
    FAST_CASCADE_ORDER,
    _cascade_single,
)


async def _create_video(db_session, video_id: uuid.UUID) -> Video:
    """Helper: insert a minimal Video record to satisfy FK constraints."""
    video = Video(
        id=video_id,
        url=f"https://youtube.com/watch?v={video_id}",
        platform="youtube",
        title="Test Video",
        status={"state": "done", "progress": 100, "message": ""},
    )
    db_session.add(video)
    await db_session.commit()
    return video


class TestGenerateAndStoreFastSummaries:
    """直接测试 fast summary 生成（非 mock）."""

    @patch("app.services.summary_service._cascade_single", new_callable=AsyncMock)
    @patch("app.services.summary_service._fetch_transcript_text", new_callable=AsyncMock)
    async def test_generates_three_levels(self, mock_fetch, mock_cascade, db_session):
        """生成 detailed + highlight + express 三级."""
        video_id = uuid.uuid4()
        await _create_video(db_session, video_id)
        mock_fetch.return_value = "这是一段测试字幕内容，讲述了人工智能的发展历程。" * 10

        # Each cascade call returns different content
        mock_cascade.side_effect = [
            "详细分析内容",  # detailed
            "精华洞见内容",  # highlight
            "极速概览内容",  # express
        ]

        results = await generate_and_store_fast_summaries(db_session, video_id)

        # _cascade_single should be called 3 times (one per level)
        assert mock_cascade.call_count == 3
        # Verify cascade order: detailed -> highlight -> express
        levels_called = [call.args[1] for call in mock_cascade.call_args_list]
        assert levels_called == ["detailed", "highlight", "express"]

    @patch("app.services.summary_service._cascade_single", new_callable=AsyncMock)
    @patch("app.services.summary_service._fetch_transcript_text", new_callable=AsyncMock)
    async def test_stores_to_database(self, mock_fetch, mock_cascade, db_session):
        """生成后正确存入数据库."""
        from sqlalchemy import select
        from app.models.summary import Summary

        video_id = uuid.uuid4()
        await _create_video(db_session, video_id)

        mock_fetch.return_value = "测试字幕内容" * 20

        mock_cascade.side_effect = [
            "## 详细分析\n- 要点一\n- 要点二",
            "### 洞见一\n精华内容",
            "- **关键词** 极速概览",
        ]

        results = await generate_and_store_fast_summaries(db_session, video_id)

        # Verify summaries were stored in DB
        result = await db_session.execute(
            select(Summary).where(Summary.video_id == video_id)
        )
        stored = {s.level: s.content for s in result.scalars().all()}

        assert "detailed" in stored
        assert "highlight" in stored
        assert "express" in stored
        assert stored["detailed"] == "## 详细分析\n- 要点一\n- 要点二"
        assert stored["highlight"] == "### 洞见一\n精华内容"
        assert stored["express"] == "- **关键词** 极速概览"

    @patch("app.services.summary_service._fetch_transcript_text", new_callable=AsyncMock)
    async def test_empty_transcript_handling(self, mock_fetch, db_session):
        """空字幕输入的处理 — _fetch_transcript_text 抛出 HTTPException."""
        video_id = uuid.uuid4()
        mock_fetch.side_effect = HTTPException(
            status_code=404, detail="Transcript has no full text content"
        )

        with pytest.raises(HTTPException) as exc_info:
            await generate_and_store_fast_summaries(db_session, video_id)

        assert exc_info.value.status_code == 404
        assert "no full text" in exc_info.value.detail

    @patch("app.services.summary_service._cascade_single", new_callable=AsyncMock)
    @patch("app.services.summary_service._fetch_transcript_text", new_callable=AsyncMock)
    async def test_partial_failure_handling(self, mock_fetch, mock_cascade, db_session):
        """某一级生成失败时异常向上传播（当前实现不做部分容错）."""
        video_id = uuid.uuid4()
        mock_fetch.return_value = "测试字幕内容" * 20

        # detailed succeeds, highlight fails
        mock_cascade.side_effect = [
            "详细分析内容",  # detailed OK
            RuntimeError("LLM returned empty choices (possible content filter block)"),
        ]

        with pytest.raises(RuntimeError, match="empty choices"):
            await generate_and_store_fast_summaries(db_session, video_id)

    @patch("app.services.summary_service._cascade_single", new_callable=AsyncMock)
    @patch("app.services.summary_service._fetch_transcript_text", new_callable=AsyncMock)
    async def test_cascade_feeds_output_to_next_level(self, mock_fetch, mock_cascade, db_session):
        """验证级联模式：每级的输出作为下一级的输入."""
        video_id = uuid.uuid4()
        await _create_video(db_session, video_id)
        transcript = "原始字幕内容" * 50
        mock_fetch.return_value = transcript

        mock_cascade.side_effect = [
            "详细分析输出",  # detailed: input = transcript
            "精华洞见输出",  # highlight: input = "详细分析输出"
            "极速概览输出",  # express: input = "精华洞见输出"
        ]

        await generate_and_store_fast_summaries(db_session, video_id)

        # First call: input is the raw transcript
        first_input = mock_cascade.call_args_list[0].args[0]
        assert first_input == transcript

        # Second call: input is the output of the first (detailed)
        second_input = mock_cascade.call_args_list[1].args[0]
        assert second_input == "详细分析输出"

        # Third call: input is the output of the second (highlight)
        third_input = mock_cascade.call_args_list[2].args[0]
        assert third_input == "精华洞见输出"
