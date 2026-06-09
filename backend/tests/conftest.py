"""Shared test fixtures for the PinCha backend test suite.

Key design decisions:
- Uses async SQLite in-memory database (via aiosqlite) so tests run without
  a real PostgreSQL instance.
- Overrides FastAPI dependencies (get_session, get_current_user, get_redis)
  so route tests are fully isolated.
- Provides a pre-authenticated test user by default.
"""

import os
os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("ENVIRONMENT", "development")

import uuid
from datetime import datetime, timezone
from typing import AsyncGenerator
from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import JSON, String, event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

# ---------------------------------------------------------------------------
# SQLite compatibility: map PostgreSQL-specific types to SQLite equivalents
# ---------------------------------------------------------------------------
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy import TypeDecorator

# Register JSONB → JSON adapter so SQLite can handle JSONB columns
from sqlalchemy.dialects import registry as _dialect_registry  # noqa: F401

import sqlalchemy.types as sa_types

# Monkey-patch: when SQLite encounters JSONB, use JSON instead
_orig_jsonb_get_dbapi_type = getattr(JSONB, "get_dbapi_type", None)

from sqlalchemy.ext.compiler import compiles
from sqlalchemy.dialects.sqlite import dialect as sqlite_dialect

@compiles(JSONB, "sqlite")
def compile_jsonb_sqlite(type_, compiler, **kw):
    return "JSON"

# Handle PostgreSQL UUID type for SQLite (store as CHAR(36) text)
@compiles(PG_UUID, "sqlite")
def compile_uuid_sqlite(type_, compiler, **kw):
    return "VARCHAR(36)"

# Patch the UUID type's result_processor so SQLite can read back UUID strings
_orig_uuid_result_processor = PG_UUID.result_processor

def _patched_uuid_result_processor(self, dialect, coltype):
    if dialect.name == "sqlite":
        def process(value):
            if value is None:
                return None
            if isinstance(value, uuid.UUID):
                return value
            return uuid.UUID(str(value))
        if self.as_uuid:
            return process
        else:
            def process_str(value):
                if value is None:
                    return None
                return str(value)
            return process_str
    return _orig_uuid_result_processor(self, dialect, coltype)

PG_UUID.result_processor = _patched_uuid_result_processor

# Also patch bind_processor to ensure UUIDs are stored as strings in SQLite
_orig_uuid_bind_processor = PG_UUID.bind_processor

def _patched_uuid_bind_processor(self, dialect):
    if dialect.name == "sqlite":
        def process(value):
            if value is None:
                return None
            if isinstance(value, uuid.UUID):
                return str(value)
            return value
        return process
    return _orig_uuid_bind_processor(self, dialect)

PG_UUID.bind_processor = _patched_uuid_bind_processor

# Handle pgvector's Vector type for SQLite (store as TEXT)
try:
    from pgvector.sqlalchemy import Vector

    @compiles(Vector, "sqlite")
    def compile_vector_sqlite(type_, compiler, **kw):
        return "TEXT"
except ImportError:
    pass

from app.models.base import Base

# Strip PostgreSQL-specific cast syntax from server_default values for SQLite
from sqlalchemy import event as sa_event
from sqlalchemy.schema import CreateTable

@sa_event.listens_for(Base.metadata, "before_create")
def _patch_pg_defaults_for_sqlite(target, connection, **kw):
    """Remove ::jsonb casts from server_default so SQLite can parse DDL."""
    if connection.dialect.name != "sqlite":
        return
    for table in target.tables.values():
        for col in table.columns:
            if col.server_default is not None:
                sd = col.server_default
                if hasattr(sd, "arg") and hasattr(sd.arg, "text"):
                    sd.arg.text = sd.arg.text.replace("::jsonb", "")

# ---------------------------------------------------------------------------
# Test database (async SQLite in-memory)
# ---------------------------------------------------------------------------

# SQLite doesn't support JSONB, UUID, etc. natively — we use
# render_as_literal=True workaround and let SQLAlchemy handle type coercion.
TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

engine_test = create_async_engine(TEST_DATABASE_URL, echo=False)
TestSessionLocal = async_sessionmaker(
    engine_test, class_=AsyncSession, expire_on_commit=False
)


@pytest.fixture(autouse=True)
async def setup_database():
    """Create all tables before each test, drop after."""
    async with engine_test.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine_test.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest.fixture
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    """Provide a clean database session for direct DB operations in tests."""
    async with TestSessionLocal() as session:
        yield session


# ---------------------------------------------------------------------------
# Mock user for auth bypass
# ---------------------------------------------------------------------------

TEST_USER_ID = uuid.UUID("00000000-0000-0000-0000-000000000099")


@pytest.fixture
def test_user():
    """A fake User object used to bypass auth in tests."""
    user = MagicMock()
    user.id = TEST_USER_ID
    user.email = "test@example.com"
    user.nickname = "TestUser"
    user.avatar_url = None
    user.name = "Test User"
    user.is_active = True
    user.is_admin = False
    user.watcha_user_id = "test_watcha_id"
    return user


# ---------------------------------------------------------------------------
# Mock Redis
# ---------------------------------------------------------------------------

@pytest.fixture
def mock_redis():
    """An AsyncMock that mimics a Redis client."""
    redis = AsyncMock()
    redis.get = AsyncMock(return_value=None)
    redis.set = AsyncMock(return_value=True)
    redis.setex = AsyncMock(return_value=True)
    redis.delete = AsyncMock(return_value=1)
    redis.ping = AsyncMock(return_value=True)
    return redis


# ---------------------------------------------------------------------------
# FastAPI test client with dependency overrides
# ---------------------------------------------------------------------------

@pytest.fixture
async def client(test_user, mock_redis) -> AsyncGenerator[AsyncClient, None]:
    """Async HTTP client with all external dependencies mocked out."""
    from app.core.auth import get_current_user
    from app.core.database import get_session
    from app.core.redis import get_redis
    from app.main import app

    async def override_get_session():
        async with TestSessionLocal() as session:
            yield session

    async def override_get_current_user():
        return test_user

    async def override_get_redis():
        return mock_redis

    app.dependency_overrides[get_session] = override_get_session
    app.dependency_overrides[get_current_user] = override_get_current_user
    app.dependency_overrides[get_redis] = override_get_redis

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    # Clean up overrides
    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Raw client (no auth bypass) — shared across test modules
# ---------------------------------------------------------------------------

@pytest.fixture
async def raw_client(mock_redis) -> AsyncGenerator[AsyncClient, None]:
    """Client WITHOUT auth override — tests real JWT validation."""
    from app.core.database import get_session
    from app.core.redis import get_redis
    from app.core.auth import _USER_CACHE
    from app.main import app
    from unittest.mock import patch, AsyncMock as _AsyncMock

    _USER_CACHE.clear()

    async def override_get_session():
        async with TestSessionLocal() as session:
            yield session

    async def override_get_redis():
        return mock_redis

    app.dependency_overrides[get_session] = override_get_session
    app.dependency_overrides[get_redis] = override_get_redis

    mock_get_redis = _AsyncMock(return_value=mock_redis)
    with patch("app.core.auth.get_redis", mock_get_redis):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac

    app.dependency_overrides.clear()
    _USER_CACHE.clear()
