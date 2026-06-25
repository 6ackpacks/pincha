"""CSRF 防护中间件。

对所有非安全方法（非 GET/HEAD/OPTIONS）的请求，检查 Origin 或 Referer header
是否在允许的域名列表中，防止跨站请求伪造攻击。
"""

import logging
import os
from urllib.parse import urlparse

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import JSONResponse

from app.config import settings

logger = logging.getLogger(__name__)

# 安全方法不需要 CSRF 检查
_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def _get_allowed_origins() -> set[str]:
    """从 settings 构建允许的 origin 集合。"""
    origins = set()
    # 主前端 URL
    if settings.FRONTEND_URL:
        parsed = urlparse(settings.FRONTEND_URL)
        origins.add(f"{parsed.scheme}://{parsed.netloc}")
    # 额外允许的 origin（与 CORS 保持一致，例如 Zeabur 自动域名）
    extra = os.environ.get("CORS_EXTRA_ORIGINS", "")
    for o in extra.split(","):
        o = o.strip()
        if o:
            parsed = urlparse(o)
            origins.add(f"{parsed.scheme}://{parsed.netloc}")
    # 开发环境额外允许 localhost
    if settings.APP_ENV == "development":
        origins.add("http://localhost:3000")
        origins.add("http://127.0.0.1:3000")
        origins.add("http://localhost:8000")
        origins.add("http://127.0.0.1:8000")
    return origins


class CSRFMiddleware(BaseHTTPMiddleware):
    """检查非安全请求的 Origin/Referer header 是否匹配允许列表。"""

    def __init__(self, app, allowed_origins: set[str] | None = None):
        super().__init__(app)
        self.allowed_origins = allowed_origins or _get_allowed_origins()

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        # 安全方法跳过检查
        if request.method in _SAFE_METHODS:
            return await call_next(request)

        # 从 Origin 或 Referer 中提取来源
        origin = request.headers.get("origin")
        if not origin:
            referer = request.headers.get("referer")
            if referer:
                parsed = urlparse(referer)
                origin = f"{parsed.scheme}://{parsed.netloc}"

        # 没有 Origin 也没有 Referer 时，需要额外检查防止 CSRF 绕过
        if not origin:
            # Bearer token 认证的 API 调用不受 CSRF 影响（非 cookie 认证）
            auth_header = request.headers.get("authorization", "")
            if auth_header.lower().startswith("bearer "):
                return await call_next(request)
            # 既无 Origin/Referer 又是 cookie 认证：无法验证请求来源，拒绝请求。
            # 不能用 Content-Type: application/json 作为豁免依据——它不能可靠地触发
            # CORS preflight（如 sendBeacon、部分客户端会绕过），否则保护退化为仅依赖
            # SameSite cookie。
            logger.warning(
                "CSRF 检查失败: 缺少 Origin/Referer 且无法验证请求来源, path=%s",
                request.url.path,
            )
            return JSONResponse(
                status_code=403,
                content={"detail": "CSRF validation failed"},
            )

        # 检查 origin 是否在允许列表中
        if origin not in self.allowed_origins:
            logger.warning(
                "CSRF 检查失败: origin=%s 不在允许列表中, path=%s",
                origin,
                request.url.path,
            )
            return JSONResponse(
                status_code=403,
                content={"detail": "Origin 不被允许，请求被拒绝"},
            )

        return await call_next(request)
