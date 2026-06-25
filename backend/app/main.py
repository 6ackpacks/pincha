import logging
import os

import httpx
import sentry_sdk
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from starlette.types import ASGIApp, Receive, Scope, Send
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
        # Memory guardrails
        max_breadcrumbs=50,
        max_value_length=1024,
    )
    logger.info("Sentry initialized (env=%s, traces=%.0f%%)", _env, (1.0 if _is_dev else 0.2) * 100)

# ---------------------------------------------------------------------------
# Security: warn if JWT secret is still the default placeholder
# ---------------------------------------------------------------------------
_JWT_DEFAULT = "changeme-use-a-long-random-secret"
if settings.JWT_SECRET_KEY == _JWT_DEFAULT:
    _is_dev = settings.APP_ENV == "development" or settings.ENVIRONMENT == "development"
    if _is_dev:
        logger.critical(
            "JWT_SECRET_KEY is using the insecure default value! "
            "Set a strong random secret before deploying to production."
        )
    else:
        raise RuntimeError(
            "JWT_SECRET_KEY must not use the default value in non-development environments. "
            "Set a strong random secret via the JWT_SECRET_KEY environment variable."
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
# Allow additional origins in any environment (e.g. frontend SSE cross-origin)
_extra_origins = os.environ.get("CORS_EXTRA_ORIGINS", "")
if _extra_origins:
    _allowed_origins += [o.strip() for o in _extra_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(dict.fromkeys(_allowed_origins)),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
class SSEAwareGZipMiddleware:
    """GZip middleware that skips compression for SSE (text/event-stream) responses."""

    def __init__(self, app: ASGIApp, minimum_size: int = 1000):
        self.app = app
        self.minimum_size = minimum_size
        self.gzip_responder = GZipMiddleware(app, minimum_size=minimum_size)

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope["type"] == "http":
            path = scope.get("path", "")
            if "/progress/stream" in path:
                await self.app(scope, receive, send)
                return
        await self.gzip_responder(scope, receive, send)


app.add_middleware(SSEAwareGZipMiddleware, minimum_size=1000)


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

_IMG_CACHE_TTL = 604800  # 7 days
_IMG_CACHE_MAX_SIZE = 2 * 1024 * 1024  # 2MB — skip cache for larger images

# Browser/CDN cache header. Redis already caches upstream bytes for 7 days
# (_IMG_CACHE_TTL); these images are immutable thumbnails so we let the browser
# and CDN keep them for 30 days to match (and avoid asymmetric re-fetching).
_IMG_BROWSER_CACHE_CONTROL = "public, max-age=2592000, immutable"

# ---------------------------------------------------------------------------
# Shared httpx clients for the image proxy.
#
# Rebuilding an AsyncClient per request forces a fresh TCP+TLS handshake every
# time, which is wasteful for a high-volume thumbnail proxy. We keep two
# process-level singletons (one direct, one via outbound proxy) with a
# keepalive connection pool so connections are reused across requests.
#
# Proxy configuration is fixed at client construction time, hence two clients:
# the proxied one is created lazily and stays None when no proxy is configured.
#
# follow_redirects stays False on the clients — redirects are tracked manually
# in _fetch() so we can enforce the SSRF host allowlist on every hop.
#
# These are deliberately NOT closed via lifespan/shutdown hooks: the app is
# created without one, and adding lifespan plumbing here is higher risk than
# the benefit. The OS reclaims the sockets on process exit.
# ---------------------------------------------------------------------------
_IMG_HTTP_LIMITS = httpx.Limits(max_keepalive_connections=20, max_connections=100)

_img_client_direct: "httpx.AsyncClient | None" = None
_img_client_proxied: "httpx.AsyncClient | None" = None


def _get_img_client(proxy: str | None) -> "httpx.AsyncClient":
    """Return a shared keepalive AsyncClient for the given proxy setting.

    Two singletons are kept: one direct, one proxied. The proxied client is
    created lazily and only when a proxy URL is supplied.
    """
    global _img_client_direct, _img_client_proxied
    if proxy:
        if _img_client_proxied is None:
            # httpx>=0.28 移除 proxies=，改用单值 proxy=（0.27 亦支持），两版本通吃
            _img_client_proxied = httpx.AsyncClient(
                proxy=proxy,
                timeout=10,
                follow_redirects=False,
                limits=_IMG_HTTP_LIMITS,
            )
        return _img_client_proxied
    if _img_client_direct is None:
        _img_client_direct = httpx.AsyncClient(
            timeout=10,
            follow_redirects=False,
            limits=_IMG_HTTP_LIMITS,
        )
    return _img_client_direct


@app.get("/img-proxy")
async def img_proxy(url: str):
    import hashlib
    from urllib.parse import urlparse
    from app.core.url_validator import validate_url_async, SSRFError

    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        return Response(status_code=400, content="Invalid URL scheme")
    if parsed.hostname not in _ALLOWED_IMG_HOSTS:
        return Response(status_code=403, content="Forbidden host")

    # --- Redis cache lookup ---
    url_hash = hashlib.md5(url.encode()).hexdigest()
    cache_key = f"img_cache:{url_hash}"
    cache_ct_key = f"img_cache:{url_hash}:ct"

    try:
        from app.core.redis import redis_client_bytes
        cached_content = await redis_client_bytes.get(cache_key)
        if cached_content is not None:
            cached_ct = await redis_client_bytes.get(cache_ct_key)
            content_type = cached_ct.decode("utf-8") if cached_ct else "image/jpeg"
            return Response(
                content=cached_content,
                media_type=content_type,
                headers={
                    "Cache-Control": _IMG_BROWSER_CACHE_CONTROL,
                    "X-Cache": "HIT",
                },
            )
    except Exception:
        # Redis unavailable — proceed without cache
        pass

    # --- Upstream fetch ---
    proxy = os.environ.get("HTTP_PROXY") or os.environ.get("YOUTUBE_PROXY")

    async def _fetch(url: str, proxy: str | None = None, max_redirects: int = 5):
        """Fetch with manual redirect following + host validation at each hop.

        Uses a shared keepalive client (direct or proxied) instead of building a
        new AsyncClient per request.
        """
        client = _get_img_client(proxy)
        current_url = url
        for _ in range(max_redirects):
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

    async def _fetch_and_cache(proxy_arg):
        r = await _fetch(url, proxy=proxy_arg)
        content_type = r.headers.get("content-type", "image/jpeg")
        content = r.content

        # Write to Redis cache (skip if too large or Redis unavailable)
        if len(content) <= _IMG_CACHE_MAX_SIZE:
            try:
                from app.core.redis import redis_client_bytes
                await redis_client_bytes.set(cache_key, content, ex=_IMG_CACHE_TTL)
                await redis_client_bytes.set(cache_ct_key, content_type.encode("utf-8"), ex=_IMG_CACHE_TTL)
            except Exception:
                pass  # graceful degradation

        return Response(
            content=content,
            media_type=content_type,
            headers={
                "Cache-Control": _IMG_BROWSER_CACHE_CONTROL,
                "X-Cache": "MISS",
            },
        )

    try:
        return await _fetch_and_cache(proxy)
    except Exception:
        if not proxy:
            logger.warning("img-proxy failed for %s (no proxy)", url)
            return Response(status_code=502, content="Upstream error")
        try:
            return await _fetch_and_cache(None)
        except Exception as exc:
            logger.warning("img-proxy failed for %s: %s", url, exc)
            return Response(status_code=502, content="Upstream error")


app.include_router(v1_router, prefix="/api/v1")
