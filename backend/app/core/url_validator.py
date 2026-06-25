"""SSRF URL Validator — blocks outbound requests to internal/private networks.

Usage:
    from app.core.url_validator import validate_url, validate_url_async, safe_async_client

    # Sync validation (Celery tasks, sync code)
    validate_url(user_supplied_url)

    # Async validation (FastAPI endpoints — non-blocking DNS resolution)
    await validate_url_async(user_supplied_url)

    # Or use the safe client factory (validates on redirects too)
    async with safe_async_client() as client:
        resp = await client.get(user_supplied_url)
"""

import asyncio
import ipaddress
import logging
import socket
from urllib.parse import urlparse

import httpx

logger = logging.getLogger(__name__)

# SSRF 防护：仅允许标准 HTTP/HTTPS 端口
ALLOWED_PORTS = {80, 443}

# Internal hostnames that should never be reached from user-supplied URLs.
# Covers common PaaS/cloud internal hostnames and cloud metadata endpoints.
_BLOCKED_HOSTNAME_PATTERNS = (
    "service-",
    ".zeabur.internal",
    "metadata.google.internal",
    "169.254.169.254",
)


class SSRFError(ValueError):
    """Raised when a URL targets an internal or private network."""
    pass


def _is_private_ip(ip_str: str) -> bool:
    """Check if an IP address is private, loopback, link-local, multicast, or reserved."""
    try:
        addr = ipaddress.ip_address(ip_str)
    except ValueError:
        return True  # If we can't parse it, block it

    return (
        addr.is_private
        or addr.is_loopback
        or addr.is_link_local
        or addr.is_multicast
        or addr.is_reserved
        or addr.is_unspecified
    )


def _check_hostname_blocked(hostname: str) -> bool:
    """Return True if hostname matches a known internal pattern."""
    hostname_lower = hostname.lower()
    for pattern in _BLOCKED_HOSTNAME_PATTERNS:
        if hostname_lower.startswith(pattern) or hostname_lower.endswith(pattern):
            return True
        if pattern in hostname_lower:
            return True
    return False


def validate_url(url: str) -> None:
    """Validate a URL is safe to fetch (not targeting internal networks).

    Raises:
        SSRFError: If the URL targets a private/internal network.
    """
    parsed = urlparse(url)

    # 1. Scheme check
    if parsed.scheme not in ("http", "https"):
        raise SSRFError(f"URL scheme '{parsed.scheme}' is not allowed; only http/https permitted")

    hostname = parsed.hostname
    if not hostname:
        raise SSRFError("URL has no hostname")

    # 2. Check for blocked internal hostnames
    if _check_hostname_blocked(hostname):
        raise SSRFError(f"Hostname '{hostname}' is blocked (internal service)")

    # 2.5. 端口白名单检查
    parsed_port = parsed.port
    if parsed_port is None:
        # 未指定端口时使用协议默认端口
        parsed_port = 443 if parsed.scheme == "https" else 80
    if parsed_port not in ALLOWED_PORTS:
        raise SSRFError(f"Port {parsed_port} not allowed (only 80/443)")

    # 3. Check if hostname is an IP literal
    try:
        addr = ipaddress.ip_address(hostname)
    except ValueError:
        addr = None  # Not an IP literal, proceed to DNS resolution

    if addr is not None:
        if _is_private_ip(str(addr)):
            raise SSRFError(f"IP address '{hostname}' is in a private/reserved range")
        return  # IP literal that's public — OK

    # 4. DNS resolution — check all A/AAAA records
    try:
        addrinfos = socket.getaddrinfo(hostname, None, socket.AF_UNSPEC, socket.SOCK_STREAM)
    except socket.gaierror:
        raise SSRFError(f"Cannot resolve hostname '{hostname}'")

    if not addrinfos:
        raise SSRFError(f"No DNS records found for '{hostname}'")

    for family, _type, _proto, _canonname, sockaddr in addrinfos:
        ip_str = sockaddr[0]
        if _is_private_ip(ip_str):
            raise SSRFError(
                f"Hostname '{hostname}' resolves to private IP '{ip_str}'"
            )


async def validate_url_async(url: str) -> None:
    """Async version of validate_url — runs DNS resolution in a thread pool.

    Use this in async contexts (FastAPI endpoints) to avoid blocking the event loop.

    Raises:
        SSRFError: If the URL targets a private/internal network.
    """
    parsed = urlparse(url)

    # 1. Scheme check
    if parsed.scheme not in ("http", "https"):
        raise SSRFError(f"URL scheme '{parsed.scheme}' is not allowed; only http/https permitted")

    hostname = parsed.hostname
    if not hostname:
        raise SSRFError("URL has no hostname")

    # 2. Check for blocked internal hostnames
    if _check_hostname_blocked(hostname):
        raise SSRFError(f"Hostname '{hostname}' is blocked (internal service)")

    # 2.5. 端口白名单检查
    parsed_port = parsed.port
    if parsed_port is None:
        # 未指定端口时使用协议默认端口
        parsed_port = 443 if parsed.scheme == "https" else 80
    if parsed_port not in ALLOWED_PORTS:
        raise SSRFError(f"Port {parsed_port} not allowed (only 80/443)")

    # 3. Check if hostname is an IP literal
    try:
        addr = ipaddress.ip_address(hostname)
    except ValueError:
        addr = None  # Not an IP literal, proceed to DNS resolution

    if addr is not None:
        if _is_private_ip(str(addr)):
            raise SSRFError(f"IP address '{hostname}' is in a private/reserved range")
        return  # IP literal that's public — OK

    # 4. DNS resolution in thread pool — non-blocking
    try:
        addrinfos = await asyncio.to_thread(
            socket.getaddrinfo, hostname, None, socket.AF_UNSPEC, socket.SOCK_STREAM
        )
    except socket.gaierror:
        raise SSRFError(f"Cannot resolve hostname '{hostname}'")

    if not addrinfos:
        raise SSRFError(f"No DNS records found for '{hostname}'")

    for family, _type, _proto, _canonname, sockaddr in addrinfos:
        ip_str = sockaddr[0]
        if _is_private_ip(ip_str):
            raise SSRFError(
                f"Hostname '{hostname}' resolves to private IP '{ip_str}'"
            )


async def _async_redirect_event_hook(request: httpx.Request) -> None:
    """Async httpx event hook that validates redirect URLs against SSRF."""
    url_str = str(request.url)
    try:
        await validate_url_async(url_str)
    except SSRFError as e:
        raise SSRFError(f"Redirect blocked: {e}") from e


def safe_async_client(**kwargs) -> httpx.AsyncClient:
    """Create an httpx.AsyncClient with SSRF redirect validation.

    All keyword arguments are passed through to httpx.AsyncClient.
    The event_hooks for 'request' will include async redirect validation.
    """
    event_hooks = kwargs.pop("event_hooks", {})
    request_hooks = list(event_hooks.get("request", []))
    request_hooks.append(_async_redirect_event_hook)
    event_hooks["request"] = request_hooks

    return httpx.AsyncClient(
        event_hooks=event_hooks,
        **kwargs,
    )
