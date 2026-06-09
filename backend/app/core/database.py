from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import settings

engine = create_async_engine(
    settings.DATABASE_URL,
    pool_size=10,
    max_overflow=20,
    pool_recycle=1800,
    pool_pre_ping=True,
)

async_session = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)

# Celery tasks run asyncio.run() in separate threads — each needs its own
# connection to avoid asyncpg "another operation is in progress" errors.
_task_engine = create_async_engine(
    settings.DATABASE_URL,
    poolclass=NullPool,
)
_task_session_factory = async_sessionmaker(_task_engine, class_=AsyncSession, expire_on_commit=False)


async def get_session() -> AsyncSession:
    """Dependency that yields an async database session."""
    async with async_session() as session:
        yield session


@asynccontextmanager
async def task_session():
    """Async session for Celery tasks.

    Uses NullPool (poolclass=NullPool) — each task gets a fresh connection
    that is immediately closed after use. This avoids asyncpg
    "another operation is in progress" errors when multiple Celery threads
    each run their own asyncio.run() event loop.
    """
    async with _task_session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
