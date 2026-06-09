"""Unified business exception hierarchy.

Raise these in services/routes instead of raw HTTPException.
The global handler in main.py converts them to proper HTTP responses.
"""
from __future__ import annotations


class AppError(Exception):
    """Base application error — all business exceptions inherit from this."""

    status_code: int = 500
    detail: str = "服务器内部错误"

    def __init__(self, detail: str | None = None, **extra):
        self.detail = detail or self.__class__.detail
        self.extra = extra
        super().__init__(self.detail)


class NotFoundError(AppError):
    status_code = 404
    detail = "资源不存在"


class ForbiddenError(AppError):
    status_code = 403
    detail = "无权访问"


class BadRequestError(AppError):
    status_code = 400
    detail = "请求参数错误"


class ConflictError(AppError):
    status_code = 409
    detail = "资源冲突"


class RateLimitedError(AppError):
    status_code = 429
    detail = "请求过于频繁，请稍后再试"


class ExternalServiceError(AppError):
    status_code = 502
    detail = "外部服务异常"
