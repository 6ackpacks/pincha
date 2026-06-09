from fastapi import APIRouter

from app.api.v1.auth import router as auth_router
from app.api.v1.videos import router as videos_router
from app.api.v1.transcripts import router as transcripts_router
from app.api.v1.summaries import router as summaries_router
from app.api.v1.mindmaps import router as mindmaps_router
from app.api.v1.knowledge_base import router as kb_router
from app.api.v1.curate_v2 import router as curate_v2_router
from app.api.v1.admin import router as admin_router
from app.api.v1.wiki import router as wiki_router
from app.api.v1.articles import router as articles_router

v1_router = APIRouter()


@v1_router.get("/")
async def v1_root():
    return {"message": "PinCha API v1"}


v1_router.include_router(auth_router)
v1_router.include_router(videos_router)
v1_router.include_router(transcripts_router)
v1_router.include_router(summaries_router)
v1_router.include_router(mindmaps_router)
v1_router.include_router(kb_router)
v1_router.include_router(curate_v2_router)
v1_router.include_router(admin_router)
v1_router.include_router(wiki_router)
v1_router.include_router(articles_router)


