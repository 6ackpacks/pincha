"""Knowledge base API: ingest, search, and chat endpoints for RAG."""

import asyncio
import logging
import uuid
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, field_serializer
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.database import get_session
from app.core.deps import require_user_video
from app.models.chunk import ChatSession, VideoChunk
from app.models.user import User
from app.services.rag_service import answer_with_rag, ingest_video

router = APIRouter(prefix="/videos/{video_id}", tags=["knowledge-base"])


# ---------------------------------------------------------------------------
# Request / Response schemas (inline, no separate schemas file needed)
# ---------------------------------------------------------------------------

class IngestResponse(BaseModel):
    chunks_count: int
    message: str


class IngestStatusResponse(BaseModel):
    ingested: bool
    chunks_count: int


class ChatRequest(BaseModel):
    question: str
    session_id: str | None = None


class SessionResponse(BaseModel):
    id: uuid.UUID
    video_id: uuid.UUID
    messages: list
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

    @field_serializer("id", "video_id")
    def serialize_uuid(self, v: uuid.UUID) -> str:
        return str(v)


# ---------------------------------------------------------------------------
# Ingest endpoints
# ---------------------------------------------------------------------------

@router.post("/ingest", response_model=IngestResponse)
async def ingest(
    video_id: uuid.UUID,
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Chunk and embed the video's transcript into video_chunks."""
    await require_user_video(db, current_user, video_id)

    try:
        result = await ingest_video(video_id, db)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return IngestResponse(
        chunks_count=result["chunks_count"],
        message=f"成功向量化 {result['chunks_count']} 个文本块",
    )


@router.get("/ingest/status", response_model=IngestStatusResponse)
async def ingest_status(
    video_id: uuid.UUID,
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Check whether the video has been ingested into the vector store."""
    await require_user_video(db, current_user, video_id)

    result = await db.execute(
        select(func.count(VideoChunk.id)).where(VideoChunk.video_id == video_id)
    )
    count = result.scalar_one()
    return IngestStatusResponse(ingested=count > 0, chunks_count=count)


@router.delete("/ingest", status_code=204, response_model=None)
async def delete_ingest(
    video_id: uuid.UUID,
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Delete all vector chunks for this video."""
    from sqlalchemy import delete as sa_delete

    await require_user_video(db, current_user, video_id)

    await db.execute(
        sa_delete(VideoChunk).where(VideoChunk.video_id == video_id)
    )
    await db.commit()


# ---------------------------------------------------------------------------
# Chat endpoint (streaming SSE)
# ---------------------------------------------------------------------------

@router.post("/chat")
async def chat(
    video_id: uuid.UUID,
    body: ChatRequest,
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Stream an RAG-based answer as Server-Sent Events.

    SSE format:
        data: <text fragment>\\n\\n
        data: [DONE]\\n\\n
    """
    # Optionally associate with a session (persist messages after streaming)
    session_id: uuid.UUID | None = None
    if body.session_id:
        try:
            session_id = uuid.UUID(body.session_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid session_id format")

    await require_user_video(db, current_user, video_id)

    async def event_stream():
        collected: list[str] = []
        try:
            async for fragment in answer_with_rag(body.question, video_id, db):
                collected.append(fragment)
                yield f"data: {fragment}\n\n"
            yield "data: [DONE]\n\n"
        except (GeneratorExit, asyncio.CancelledError):
            # Client disconnected — stop streaming, save what we have
            pass
        except Exception as exc:
            logger.warning("RAG stream error: %s", exc)
            yield "data: [ERROR] 回答时遇到问题，请稍后再试\n\n"
        finally:
            # Persist the exchange to the session if one was provided
            answer_text = "".join(collected)
            collected.clear()  # Release references to fragment strings

            if session_id is not None and answer_text:
                try:
                    result = await db.execute(
                        select(ChatSession).where(ChatSession.id == session_id)
                    )
                    session = result.scalar_one_or_none()
                    if session is not None:
                        now_iso = datetime.now(timezone.utc).isoformat()
                        messages = list(session.messages)
                        messages.append(
                            {"role": "user", "content": body.question, "created_at": now_iso}
                        )
                        messages.append(
                            {"role": "assistant", "content": answer_text, "created_at": now_iso}
                        )
                        session.messages = messages
                        session.updated_at = datetime.now(timezone.utc)
                        await db.commit()
                except Exception:
                    pass  # Best-effort save on disconnect

    return StreamingResponse(event_stream(), media_type="text/event-stream")


# ---------------------------------------------------------------------------
# Chat session endpoints
# ---------------------------------------------------------------------------

@router.get("/chat/sessions", response_model=list[SessionResponse])
async def list_sessions(
    video_id: uuid.UUID,
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """List all chat sessions for a video."""
    await require_user_video(db, current_user, video_id)

    result = await db.execute(
        select(ChatSession)
        .where(ChatSession.video_id == video_id)
        .order_by(ChatSession.created_at.desc())
    )
    return [
        SessionResponse.model_validate(s, from_attributes=True)
        for s in result.scalars().all()
    ]


@router.post("/chat/sessions", response_model=SessionResponse, status_code=201)
async def create_session(
    video_id: uuid.UUID,
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Create a new chat session for a video."""
    await require_user_video(db, current_user, video_id)

    session = ChatSession(video_id=video_id)
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return SessionResponse.model_validate(session, from_attributes=True)


@router.get("/chat/sessions/{session_id}", response_model=SessionResponse)
async def get_session(
    video_id: uuid.UUID,
    session_id: uuid.UUID,
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Get a specific chat session and its message history."""
    await require_user_video(db, current_user, video_id)

    result = await db.execute(
        select(ChatSession).where(
            ChatSession.id == session_id,
            ChatSession.video_id == video_id,
        )
    )
    session = result.scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return SessionResponse.model_validate(session, from_attributes=True)
