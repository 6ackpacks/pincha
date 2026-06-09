"""RAG service: chunk, embed, ingest, search, and answer for video content."""

import logging
import uuid
from typing import AsyncGenerator

import litellm
from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.chunk import VIDEO_CHUNK_EMBEDDING_DIMENSIONS, VideoChunk
from app.models.transcript import Transcript

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Chunking
# ---------------------------------------------------------------------------

def chunk_transcript(
    segments: list[dict],
    chunk_size_chars: int = 400,
) -> list[dict]:
    """Group transcript segments into text chunks by character count.

    Args:
        segments: List of {start, end, text} dicts from the transcripts table.
        chunk_size_chars: Approximate maximum characters per chunk.

    Returns:
        List of {content, start_time, end_time, chunk_index} dicts.
    """
    chunks: list[dict] = []
    current_texts: list[str] = []
    current_start: float | None = None
    current_end: float | None = None
    current_chars = 0
    chunk_index = 0

    for seg in segments:
        seg_text: str = seg.get("text", "").strip()
        if not seg_text:
            continue

        seg_start: float | None = seg.get("start")
        seg_end: float | None = seg.get("end")

        if current_start is None:
            current_start = seg_start

        current_texts.append(seg_text)
        current_end = seg_end
        current_chars += len(seg_text)

        if current_chars >= chunk_size_chars:
            chunks.append(
                {
                    "content": " ".join(current_texts),
                    "start_time": current_start,
                    "end_time": current_end,
                    "chunk_index": chunk_index,
                }
            )
            chunk_index += 1
            current_texts = []
            current_start = None
            current_end = None
            current_chars = 0

    # Flush any remaining content
    if current_texts:
        chunks.append(
            {
                "content": " ".join(current_texts),
                "start_time": current_start,
                "end_time": current_end,
                "chunk_index": chunk_index,
            }
        )

    return chunks


# ---------------------------------------------------------------------------
# Embedding
# ---------------------------------------------------------------------------

_embedding_client = None


def _get_embedding_client():
    """Return a module-level singleton AsyncOpenAI client for embeddings."""
    global _embedding_client
    if _embedding_client is None:
        from openai import AsyncOpenAI

        api_key = settings.EMBEDDING_API_KEY or settings.DASHSCOPE_API_KEY or settings.OPENAI_API_KEY
        if not api_key:
            return None
        base_url = settings.EMBEDDING_API_BASE or "https://dashscope.aliyuncs.com/compatible-mode/v1"
        _embedding_client = AsyncOpenAI(
            api_key=api_key,
            base_url=base_url,
        )
    return _embedding_client


async def embed_texts(texts: list[str]) -> list[list[float]] | None:
    """Embed texts via DashScope text-embedding-v3 (OpenAI-compatible endpoint).

    DashScope limit: max 10 texts per request — batches automatically.
    Returns None (instead of raising) when the API is unavailable.
    """
    client = _get_embedding_client()
    if client is None:
        logger.warning("No embedding API key configured — skipping embedding")
        return None

    try:
        # DashScope max batch size = 10
        BATCH_SIZE = 10
        all_embeddings: list[list[float]] = []
        for i in range(0, len(texts), BATCH_SIZE):
            batch = texts[i : i + BATCH_SIZE]
            resp = await client.embeddings.create(
                model="text-embedding-v3",
                input=batch,
                dimensions=VIDEO_CHUNK_EMBEDDING_DIMENSIONS,
            )
            # resp.data is sorted by index
            all_embeddings.extend(item.embedding for item in resp.data)
        return all_embeddings
    except Exception as exc:
        logger.warning("Embedding API unavailable (%s: %s) — falling back to keyword search", type(exc).__name__, exc)
        return None


# ---------------------------------------------------------------------------
# Ingestion
# ---------------------------------------------------------------------------

async def ingest_video(
    video_id: uuid.UUID,
    db: AsyncSession,
) -> dict:
    """Chunk and embed a video's transcript, storing results in video_chunks.

    Deletes any existing chunks for the video first to allow re-ingestion.

    Args:
        video_id: UUID of the video to ingest.
        db: Async SQLAlchemy session.

    Returns:
        {"chunks_count": int}
    """
    # Fetch transcript segments
    result = await db.execute(
        select(Transcript.segments).where(Transcript.video_id == video_id)
    )
    segments = result.scalar_one_or_none()
    if not segments:
        raise ValueError(f"No transcript found for video {video_id}")

    # Build chunks
    chunks = chunk_transcript(segments)
    if not chunks:
        raise ValueError("Transcript produced no chunks (empty content?)")

    logger.info("Ingesting video %s: %d chunks", video_id, len(chunks))

    # Try embedding (may return None if API unavailable)
    texts = [c["content"] for c in chunks]
    embeddings = await embed_texts(texts)
    if embeddings is None:
        logger.info("Storing %d chunks without embeddings (keyword-only mode)", len(chunks))

    # Delete existing chunks for idempotency
    await db.execute(
        delete(VideoChunk).where(VideoChunk.video_id == video_id)
    )

    # Insert new chunks
    for i, chunk in enumerate(chunks):
        db.add(
            VideoChunk(
                video_id=video_id,
                content=chunk["content"],
                embedding=embeddings[i] if embeddings else None,
                chunk_index=chunk["chunk_index"],
                start_time=chunk["start_time"],
                end_time=chunk["end_time"],
            )
        )

    await db.commit()
    logger.info("Ingestion complete for video %s: %d chunks stored", video_id, len(chunks))
    return {"chunks_count": len(chunks)}


# ---------------------------------------------------------------------------
# Hybrid search (semantic + keyword, RRF fusion)
# ---------------------------------------------------------------------------

async def search_chunks(
    query: str,
    video_id: uuid.UUID,
    db: AsyncSession,
    top_k: int = 5,
) -> list[dict]:
    """Hybrid search over video_chunks.

    Priority order:
      1. Hybrid (pgvector cosine + BM25 RRF) — when embeddings exist and API available
      2. BM25 full-text only               — when embeddings are NULL
      3. ILIKE substring                   — when BM25 returns nothing (common for Chinese)
      4. First top_k chunks in order       — ultimate fallback

    Args:
        query: Natural-language search query.
        video_id: Restrict search to this video.
        db: Async SQLAlchemy session.
        top_k: Number of results to return.

    Returns:
        List of {id, content, start_time, end_time, score} dicts ordered by score desc.
    """
    pool = top_k * 5

    # ── Check whether this video has embeddings ──────────────────────────────
    has_embeddings_result = await db.execute(
        select(func.count(VideoChunk.id))
        .where(VideoChunk.video_id == video_id)
        .where(VideoChunk.embedding.isnot(None))
    )
    has_embeddings = (has_embeddings_result.scalar_one() or 0) > 0

    # ── Layer 1: Hybrid (vector + BM25 RRF) ─────────────────────────────────
    if has_embeddings:
        query_embeddings = await embed_texts([query])
        if query_embeddings is not None:
            query_embedding = query_embeddings[0]
            cosine_distance = VideoChunk.embedding.op("<=>")(query_embedding)
            semantic_cte = (
                select(
                    VideoChunk.id.label("chunk_id"),
                    func.row_number().over(order_by=cosine_distance).label("rank"),
                )
                .where(VideoChunk.video_id == video_id)
                .where(VideoChunk.embedding.isnot(None))
                .order_by(cosine_distance)
                .limit(pool)
                .cte("semantic")
            )
            tsvec = func.to_tsvector(text("'simple'"), VideoChunk.content)
            tsq = func.plainto_tsquery(text("'simple'"), query)
            keyword_cte = (
                select(
                    VideoChunk.id.label("chunk_id"),
                    func.row_number().over(order_by=func.ts_rank(tsvec, tsq).desc()).label("rank"),
                )
                .where(VideoChunk.video_id == video_id)
                .where(tsvec.op("@@")(tsq))
                .order_by(func.ts_rank(tsvec, tsq).desc())
                .limit(pool)
                .cte("keyword")
            )
            rrf_score = (
                func.coalesce(1.0 / (60 + semantic_cte.c.rank), 0.0)
                + func.coalesce(1.0 / (60 + keyword_cte.c.rank), 0.0)
            ).label("score")
            joined = semantic_cte.outerjoin(keyword_cte, semantic_cte.c.chunk_id == keyword_cte.c.chunk_id, full=True)
            merged_id = func.coalesce(semantic_cte.c.chunk_id, keyword_cte.c.chunk_id).label("merged_id")
            fusion_cte = (
                select(merged_id, rrf_score).select_from(joined).order_by(rrf_score.desc()).limit(top_k).cte("fusion")
            )
            rows = await db.execute(
                select(VideoChunk, fusion_cte.c.score)
                .join(fusion_cte, VideoChunk.id == fusion_cte.c.merged_id)
                .order_by(fusion_cte.c.score.desc())
            )
            results = [
                {"id": str(c.id), "content": c.content, "start_time": c.start_time, "end_time": c.end_time, "score": float(s)}
                for c, s in rows
            ]
            if results:
                return results

    # ── Layer 2: BM25 full-text only ────────────────────────────────────────
    tsvec = func.to_tsvector(text("'simple'"), VideoChunk.content)
    tsq = func.plainto_tsquery(text("'simple'"), query)
    rows = await db.execute(
        select(VideoChunk, func.ts_rank(tsvec, tsq).label("score"))
        .where(VideoChunk.video_id == video_id)
        .where(tsvec.op("@@")(tsq))
        .order_by(func.ts_rank(tsvec, tsq).desc())
        .limit(top_k)
    )
    results = [
        {"id": str(c.id), "content": c.content, "start_time": c.start_time, "end_time": c.end_time, "score": float(s)}
        for c, s in rows
    ]
    if results:
        return results

    # ── Layer 3: ILIKE substring (for Chinese where BM25 tokenisation fails) ─
    keywords = [w.strip() for w in query.split() if len(w.strip()) >= 2][:5]
    if keywords:
        ilike_filter = func.lower(VideoChunk.content).contains(func.lower(keywords[0]))
        for kw in keywords[1:]:
            ilike_filter = ilike_filter | func.lower(VideoChunk.content).contains(func.lower(kw))
        rows = await db.execute(
            select(VideoChunk)
            .where(VideoChunk.video_id == video_id)
            .where(ilike_filter)
            .order_by(VideoChunk.chunk_index)
            .limit(top_k)
        )
        results = [
            {"id": str(c.id), "content": c.content, "start_time": c.start_time, "end_time": c.end_time, "score": 0.1}
            for c in rows.scalars()
        ]
        if results:
            return results

    # ── Layer 4: Return first top_k chunks in order (ultimate fallback) ─────
    rows = await db.execute(
        select(VideoChunk)
        .where(VideoChunk.video_id == video_id)
        .order_by(VideoChunk.chunk_index)
        .limit(top_k)
    )
    return [
        {"id": str(c.id), "content": c.content, "start_time": c.start_time, "end_time": c.end_time, "score": 0.0}
        for c in rows.scalars()
    ]


# ---------------------------------------------------------------------------
# RAG answer (streaming)
# ---------------------------------------------------------------------------

_RAG_SYSTEM_PROMPT = (
    "你是一位视频内容助手。以下是与用户问题最相关的视频字幕片段（包含时间戳）。\n"
    "请严格基于这些片段内容来回答用户的问题，不要编造视频中没有提到的信息。\n"
    "如果提供的片段不足以回答问题，请如实告知。\n"
    "回答使用中文，简洁清晰，可引用具体时间点。"
)


def _format_context(chunks: list[dict]) -> str:
    """Format retrieved chunks as a numbered context block with timestamps."""
    lines = ["【相关视频片段】\n"]
    for i, chunk in enumerate(chunks, 1):
        start = chunk.get("start_time")
        end = chunk.get("end_time")
        ts = ""
        if start is not None and end is not None:
            ts = f"（{_fmt_time(start)} - {_fmt_time(end)}）"
        lines.append(f"[{i}]{ts}\n{chunk['content']}\n")
    return "\n".join(lines)


def _fmt_time(seconds: float) -> str:
    """Convert seconds to mm:ss format."""
    m, s = divmod(int(seconds), 60)
    return f"{m:02d}:{s:02d}"


async def answer_with_rag(
    question: str,
    video_id: uuid.UUID,
    db: AsyncSession,
) -> AsyncGenerator[str, None]:
    """Async generator that yields SSE text chunks for a RAG-based answer.

    Steps:
      1. Embed question and retrieve top-k relevant chunks.
      2. Build a context-enriched prompt.
      3. Stream the LLM response, yielding each text delta.

    Yields:
        Plain text fragments (the caller wraps these in SSE format).
    """
    # 1. Retrieve relevant chunks
    chunks = await search_chunks(question, video_id, db)

    if not chunks:
        yield "抱歉，该视频尚未建立知识库索引，请先调用 /ingest 接口完成向量化。"
        return

    # 2. Build messages
    context = _format_context(chunks)
    user_message = f"{context}\n\n【用户问题】\n{question}"

    messages = [
        {"role": "system", "content": _RAG_SYSTEM_PROMPT},
        {"role": "user", "content": user_message},
    ]

    # 3. Stream LLM response
    api_base = settings.SUMMARY_API_BASE or None
    api_key = settings.OPENAI_API_KEY or None

    response = await litellm.acompletion(
        model=settings.SUMMARY_MODEL,
        messages=messages,
        stream=True,
        api_base=api_base,
        api_key=api_key,
        timeout=120,
    )

    async for chunk in response:
        delta = chunk.choices[0].delta
        content = getattr(delta, "content", None)
        if content:
            yield content
