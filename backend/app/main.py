import logging
import os

import sentry_sdk
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from fastapi.responses import JSONResponse, Response
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration
from sentry_sdk.integrations.celery import CeleryIntegration
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.api.v1.router import v1_router
from app.config import settings
from app.core.exceptions import AppError
from app.core.csrf import CSRFMiddleware
from app.core.middleware import RequestIDMiddleware, StructuredLoggingMiddleware
from app.core.rate_limit import limiter

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Sentry — 性能监控 & 错误追踪
# ---------------------------------------------------------------------------
_sentry_dsn = os.environ.get("SENTRY_DSN")
if _sentry_dsn:
    _env = os.environ.get("APP_ENV", "development")
    _is_dev = _env == "development"
    sentry_sdk.init(
        dsn=_sentry_dsn,
        integrations=[
            FastApiIntegration(),
            SqlalchemyIntegration(),
            CeleryIntegration(monitor_beat_tasks=True),
        ],
        # 开发环境 100% 采样，生产 20%
        traces_sample_rate=1.0 if _is_dev else 0.2,
        profiles_sample_rate=0.1,
        environment=_env,
        send_default_pii=False,
    )
    logger.info("Sentry initialized (env=%s, traces=%.0f%%)", _env, (1.0 if _is_dev else 0.2) * 100)

# ---------------------------------------------------------------------------
# Security: block startup if JWT secret is still the default placeholder
# ---------------------------------------------------------------------------
_JWT_DEFAULT = "changeme-use-a-long-random-secret"
if settings.JWT_SECRET_KEY == _JWT_DEFAULT:
    raise RuntimeError(
        "JWT_SECRET_KEY is using the insecure default value. "
        "Generate a secure key: python -c \"import secrets; print(secrets.token_urlsafe(32))\" "
        "and set it in your .env file."
    )

# ---------------------------------------------------------------------------
# Security: warn if DATABASE_URL / REDIS_URL still use default/local values in production
# ---------------------------------------------------------------------------
if settings.APP_ENV == "production":
    _defaults = {
        "DATABASE_URL": "postgresql",
        "REDIS_URL": "redis://localhost",
    }
    for _key, _default_pattern in _defaults.items():
        _value = getattr(settings, _key, "")
        if _default_pattern in _value and ("localhost" in _value or "postgres:postgres" in _value):
            import warnings
            warnings.warn(
                f"\u26a0\ufe0f  {_key} appears to use a default/local value in production!",
                stacklevel=2,
            )

_docs_url = "/docs" if settings.APP_ENV == "development" else None
_redoc_url = "/redoc" if settings.APP_ENV == "development" else None
app = FastAPI(title="PinCha API", version="0.1.0", docs_url=_docs_url, redoc_url=_redoc_url)


@app.exception_handler(AppError)
async def app_error_handler(request: Request, exc: AppError):
    """Convert business exceptions to structured JSON responses."""
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail, **exc.extra},
    )


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.exception(f"Unhandled exception on {request.method} {request.url.path}")
    detail = "Internal server error"
    return JSONResponse(status_code=500, content={"detail": detail})

# Rate limiting
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

# CORS — must list explicit origins when allow_credentials=True
_allowed_origins = [settings.FRONTEND_URL]
if settings.APP_ENV == "development":
    _dev_origins = os.environ.get("CORS_DEV_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
    _allowed_origins += [o.strip() for o in _dev_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(dict.fromkeys(_allowed_origins)),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=1000)


class RequestSizeLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        content_length = request.headers.get("content-length")
        if content_length and int(content_length) > 10 * 1024 * 1024:  # 10MB
            return Response(status_code=413, content="Payload too large")
        return await call_next(request)


app.add_middleware(RequestSizeLimitMiddleware)

# ---------------------------------------------------------------------------
# Custom middleware — order matters (outermost runs first)
# ---------------------------------------------------------------------------
app.add_middleware(CSRFMiddleware)
app.add_middleware(StructuredLoggingMiddleware)
app.add_middleware(RequestIDMiddleware)


@app.get("/health")
async def health_check():
    return {"status": "ok"}


@app.get("/health/ready")
async def readiness_check():
    """检查核心依赖（数据库/Redis）是否就绪"""
    import asyncio
    from sqlalchemy import text as sa_text
    checks = {"db": "ok", "redis": "ok"}

    try:
        from app.core.database import async_session
        async with async_session() as session:
            await asyncio.wait_for(session.execute(sa_text("SELECT 1")), timeout=2)
    except Exception:
        checks["db"] = "unavailable"

    try:
        from app.core.redis import redis_client
        await asyncio.wait_for(redis_client.ping(), timeout=2)
    except Exception:
        checks["redis"] = "unavailable"

    all_ok = all(v == "ok" for v in checks.values())
    status_code = 200 if all_ok else 503
    from fastapi.responses import JSONResponse
    return JSONResponse(status_code=status_code, content={"status": "ready" if all_ok else "degraded", "checks": checks})


# ---------------------------------------------------------------------------
# Image proxy — serves YouTube thumbnails through the backend proxy
# so the browser never needs to reach blocked domains directly.
# Usage: /img-proxy?url=https://i.ytimg.com/vi/xxx/maxresdefault.jpg
# ---------------------------------------------------------------------------

_ALLOWED_IMG_HOSTS = {
    "i.ytimg.com", "img.youtube.com",
    "i0.hdslb.com", "i1.hdslb.com", "i2.hdslb.com",
}


@app.get("/img-proxy")
async def img_proxy(url: str):
    from urllib.parse import urlparse
    from app.core.url_validator import validate_url_async, SSRFError

    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        return Response(status_code=400, content="Invalid URL scheme")
    if parsed.hostname not in _ALLOWED_IMG_HOSTS:
        return Response(status_code=403, content="Forbidden host")

    proxy = os.environ.get("HTTP_PROXY") or os.environ.get("YOUTUBE_PROXY")
    proxies = {"http://": proxy, "https://": proxy} if proxy else None

    async def _fetch(url: str, proxies=None, max_redirects: int = 5):
        """Fetch with manual redirect following + host validation at each hop."""
        import httpx
        current_url = url
        for _ in range(max_redirects):
            async with httpx.AsyncClient(proxies=proxies, timeout=10, follow_redirects=False) as client:
                r = await client.get(current_url, headers={"User-Agent": "Mozilla/5.0"})
            if r.status_code in (301, 302, 303, 307, 308):
                location = r.headers.get("location")
                if not location:
                    return r
                redirect_parsed = urlparse(location)
                if redirect_parsed.hostname and redirect_parsed.hostname not in _ALLOWED_IMG_HOSTS:
                    raise SSRFError(f"Redirect to forbidden host: {redirect_parsed.hostname}")
                try:
                    await validate_url_async(location)
                except SSRFError:
                    raise
                current_url = location
            else:
                return r
        raise SSRFError("Too many redirects")

    try:
        r = await _fetch(url, proxies=proxies)
        content_type = r.headers.get("content-type", "image/jpeg")
        return Response(content=r.content, media_type=content_type,
                        headers={"Cache-Control": "public, max-age=86400"})
    except Exception:
        if not proxies:
            logger.warning("img-proxy failed for %s (no proxy)", url)
            return Response(status_code=502, content="Upstream error")
        try:
            r = await _fetch(url, proxies=None)
            content_type = r.headers.get("content-type", "image/jpeg")
            return Response(content=r.content, media_type=content_type,
                            headers={"Cache-Control": "public, max-age=86400"})
        except Exception as exc:
            logger.warning("img-proxy failed for %s: %s", url, exc)
            return Response(status_code=502, content="Upstream error")


app.include_router(v1_router, prefix="/api/v1")
