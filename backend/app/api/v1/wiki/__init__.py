"""Wiki 子包入口 — 组装所有子路由并对外暴露统一的 router。

对外接口保持不变：
    from app.api.v1.wiki import router
    from app.api.v1.wiki import make_slug, sync_wikilinks_to_relations
"""

from fastapi import APIRouter

from app.api.v1.wiki.pages import router as pages_router
from app.api.v1.wiki.graph import router as graph_router
from app.api.v1.wiki.ingest import router as ingest_router
from app.api.v1.wiki.articles import router as articles_router

# 向后兼容：外部模块通过 from app.api.v1.wiki import make_slug 等方式引用
from app.services.wiki_utils import make_slug, sync_wikilinks_to_relations  # noqa: F401

# 向后兼容：外部模块通过 from app.api.v1.wiki import XxxSchema 方式引用
from app.api.v1.wiki.schemas import (  # noqa: F401
    WikiPageSummary,
    ArticleSummary,
    QuotaResponse,
    IngestVideoRequest,
    CreateArticleRequest,
    AskRequest,
    WikiVideoPageRef,
    WikiVideoItem,
)

# 主 router，挂载 /wiki 前缀
router = APIRouter(prefix="/wiki", tags=["wiki"])

# 包含所有子路由（子路由不带前缀，路径相对于 /wiki）
router.include_router(pages_router)
router.include_router(graph_router)
router.include_router(ingest_router)
router.include_router(articles_router)
