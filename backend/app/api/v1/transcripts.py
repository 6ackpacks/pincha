import logging
import time
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cache import TRANSCRIPT_TTL, cache_get, cache_set, transcript_key
from app.core.database import get_session
from app.core.auth import get_current_user
from app.core.deps import require_user_video
from app.models.transcript import Transcript
from app.models.user import User
from app.schemas.transcript import TranscriptResponse, TranslateRequest, TranslateResponse

logger = logging.getLogger(__name__)
router = APIRouter(tags=["transcripts"])


@router.get("/videos/{video_id}/transcript", response_model=TranscriptResponse)
async def get_transcript(
    video_id: UUID,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Get the transcript for a video."""
    await require_user_video(session, current_user, video_id)

    t0 = time.perf_counter()
    key = transcript_key(str(video_id))
    cached = await cache_get(key)
    if cached is not None:
        logger.info("transcript cache hit for %s (%.0fms)", video_id, (time.perf_counter() - t0) * 1000)
        return cached

    result = await session.execute(
        select(Transcript).where(Transcript.video_id == video_id)
    )
    transcript = result.scalar_one_or_none()
    if transcript is None:
        raise HTTPException(status_code=404, detail="Transcript not found")

    serialized = TranscriptResponse.model_validate(transcript).model_dump(mode="json")
    elapsed = (time.perf_counter() - t0) * 1000
    logger.info("transcript DB fetch for %s (%.0fms)", video_id, elapsed)
    await cache_set(key, serialized, TRANSCRIPT_TTL)
    return transcript


@router.get("/videos/{video_id}/transcript/export")
async def export_transcript(
    video_id: UUID,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Export transcript as a plain text file download.

    Format: [MM:SS] text per line.
    """
    from fastapi.responses import Response

    await require_user_video(session, current_user, video_id)

    result = await session.execute(
        select(Transcript).where(Transcript.video_id == video_id)
    )
    transcript = result.scalar_one_or_none()
    if transcript is None:
        raise HTTPException(status_code=404, detail="Transcript not found")

    lines = []
    for seg in transcript.segments:
        start = seg.get("start", 0)
        minutes = int(start // 60)
        seconds = int(start % 60)
        lines.append(f"[{minutes:02d}:{seconds:02d}] {seg.get('text', '')}")

    content = "\n".join(lines)

    return Response(
        content=content,
        media_type="text/plain; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="transcript_{video_id}.txt"'
        },
    )


@router.post("/videos/{video_id}/transcript/translate", response_model=TranslateResponse)
async def translate_transcript(
    video_id: UUID,
    body: TranslateRequest,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Translate specific transcript segments on demand. Results are cached in DB."""
    from app.services.translation_service import translate_segments

    await require_user_video(session, current_user, video_id)

    try:
        return await translate_segments(
            db=session,
            video_id=video_id,
            segment_indices=body.segment_indices,
            target_lang=body.target_lang,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
