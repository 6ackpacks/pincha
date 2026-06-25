"""Monitoring and observability utilities."""
import logging
from typing import Optional, Any

logger = logging.getLogger(__name__)

# Lazy import Sentry
_sentry_sdk: Optional[Any] = None
_has_sentry: bool = False

try:
    import sentry_sdk as _sentry_sdk_module
    _sentry_sdk = _sentry_sdk_module
    _has_sentry = _sentry_sdk.is_initialized()
except ImportError:
    pass


def has_sentry() -> bool:
    """Check if Sentry is available and initialized."""
    return _has_sentry


def capture_exception(exc: Optional[Exception] = None, **kwargs) -> None:
    """Capture exception to Sentry if available."""
    if _has_sentry and _sentry_sdk:
        _sentry_sdk.capture_exception(exc, **kwargs)


def start_transaction(op: str, name: str, **kwargs):
    """Start a Sentry transaction if available."""
    if _has_sentry and _sentry_sdk:
        return _sentry_sdk.start_transaction(op=op, name=name, **kwargs)
    return None


def start_span(op: str, **kwargs):
    """Start a Sentry span if available."""
    if _has_sentry and _sentry_sdk:
        return _sentry_sdk.start_span(op=op, **kwargs)
    return None
