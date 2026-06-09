"""Unified knowledge base routes (KB CRUD + RAG)."""

from fastapi import APIRouter

from app.api.v1.knowledge_base.kbs import router as kbs_router
from app.api.v1.knowledge_base.rag import router as rag_router

router = APIRouter()
router.include_router(kbs_router)
router.include_router(rag_router)
