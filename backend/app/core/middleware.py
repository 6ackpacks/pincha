"""Custom middleware: request ID injection + structured logging context."""
from __future__ import annotations

import logging
import time
import uuid
from contextvars import ContextVar

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response

logger = logging.getLogger("pingcha")

# Context var accessible anywhere in the same async task
request_id_ctx: ContextVar[str] = ContextVar("request_id", default="-")


class RequestIDMiddleware(BaseHTTPMiddleware):
    """Assigns a unique request ID to every inbound request.

    - Reads X-Request-ID from client (e.g. nginx) or generates a new one.
    - Stores it in a ContextVar so services/tasks can include it in logs.
    - Returns it in the response header for traceability.
    """

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        rid = request.headers.get("X-Request-ID") or uuid.uuid4().hex[:12]
        request_id_ctx.set(rid)
        request.state.request_id = rid

        response = await call_next(request)
        response.headers["X-Request-ID"] = rid
        return response


class StructuredLoggingMiddleware(BaseHTTPMiddleware):
    """Logs every request with method, path, status, duration, and request ID."""

    SKIP_PATHS = {"/health", "/docs", "/openapi.json", "/redoc"}

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        path = request.url.path
        if path in self.SKIP_PATHS or path.startswith("/img-proxy"):
            return await call_next(request)

        start = time.perf_counter()
        response = await call_next(request)
        elapsed_ms = (time.perf_counter() - start) * 1000

        rid = request_id_ctx.get("-")
        user_id = getattr(request.state, "user_id", None) or "-"

        if elapsed_ms > 2000:
            lvl = logging.ERROR
        elif elapsed_ms > 500:
            lvl = logging.WARNING
        else:
            lvl = logging.INFO

        logger.log(
            lvl,
            "[%s] %s %s → %d  %.0fms  user=%s",
            rid, request.method, path, response.status_code, elapsed_ms, user_id,
        )

        response.headers["X-Response-Time"] = f"{elapsed_ms:.0f}ms"
        return response
