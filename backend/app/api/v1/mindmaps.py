import logging
import time
import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cache import MINDMAP_TTL, cache_delete, cache_get, cache_set, mindmap_key
from app.core.auth import get_current_user
from app.core.database import get_session
from app.core.deps import require_user_video
from app.models.user import User
from app.schemas.mindmap import MindmapResponse
from app.services.mindmap_service import get_or_create_mindmap, regenerate_mindmap

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/videos/{video_id}/mindmap", tags=["mindmaps"])


@router.get("", response_model=MindmapResponse)
async def get_mindmap(
    video_id: uuid.UUID,
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Get or generate mindmap for a video."""
    await require_user_video(db, current_user, video_id)

    t0 = time.perf_counter()
    key = mindmap_key(str(video_id))
    cached = await cache_get(key)
    if cached is not None:
        logger.info("mindmap cache hit for %s (%.0fms)", video_id, (time.perf_counter() - t0) * 1000)
        return cached

    logger.info("mindmap cache miss for %s, generating...", video_id)
    mindmap, cached_flag = await get_or_create_mindmap(db, video_id)
    elapsed = (time.perf_counter() - t0) * 1000
    logger.info("mindmap generated for %s (%.0fms)", video_id, elapsed)
    response = MindmapResponse.model_validate(mindmap)
    response.cached = cached_flag
    await cache_set(key, response.model_dump(mode="json"), MINDMAP_TTL)
    return response


@router.post("/regenerate", response_model=MindmapResponse)
async def regenerate(
    video_id: uuid.UUID,
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Force regenerate mindmap, overwriting cache."""
    await require_user_video(db, current_user, video_id)

    mindmap = await regenerate_mindmap(db, video_id)
    # Bust the cache
    await cache_delete(mindmap_key(str(video_id)))
    return MindmapResponse.model_validate(mindmap)
