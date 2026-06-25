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


class _SSRFSafeTransport(httpx.AsyncHTTPTransport):
    """httpx transport that pins each connection to a freshly-validated public IP.

    This closes the DNS-rebinding / TOCTOU gap: validate_url_async resolves and
    checks DNS, but the connect-time resolution happens independently and could
    return a different (internal) IP. Here we resolve once, validate, then connect
    to that exact IP — so validation and connection share a single resolution.

    The original hostname is preserved in the Host header (virtual hosting) and in
    the TLS sni_hostname extension (SNI + certificate verification), so pinning the
    URL host to the literal IP does not break HTTPS.
    """

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        hostname = request.url.host
        if not hostname:
            raise SSRFError("Request has no hostname")

        # If the host is already an IP literal, validate it directly — no rebinding
        # is possible and no SNI rewrite is needed.
        try:
            ipaddress.ip_address(hostname)
            is_ip_literal = True
        except ValueError:
            is_ip_literal = False

        if is_ip_literal:
            if _is_private_ip(hostname):
                raise SSRFError(f"IP address '{hostname}' is in a private/reserved range")
            return await super().handle_async_request(request)

        # Resolve and validate, then pin to the first public IP we find.
        try:
            addrinfos = await asyncio.to_thread(
                socket.getaddrinfo,
                hostname,
                request.url.port,
                socket.AF_UNSPEC,
                socket.SOCK_STREAM,
            )
        except socket.gaierror:
            raise SSRFError(f"Cannot resolve hostname '{hostname}'")

        if not addrinfos:
            raise SSRFError(f"No DNS records found for '{hostname}'")

        safe_ip = None
        for _family, _type, _proto, _canonname, sockaddr in addrinfos:
            ip_str = sockaddr[0]
            if _is_private_ip(ip_str):
                # Any private IP in the record set is treated as hostile (the
                # attacker may be racing public/private answers).
                raise SSRFError(
                    f"Hostname '{hostname}' resolves to private IP '{ip_str}'"
                )
            if safe_ip is None:
                safe_ip = ip_str

        if safe_ip is None:
            raise SSRFError(f"No usable IP for '{hostname}'")

        # Pin the socket target to the validated IP while keeping the original
        # hostname for HTTP routing (Host header, already set by httpx) and for
        # TLS (sni_hostname extension → server_hostname in httpcore).
        request.url = request.url.copy_with(host=safe_ip)
        request.extensions = dict(request.extensions)
        request.extensions["sni_hostname"] = hostname

        return await super().handle_async_request(request)


def safe_async_client(**kwargs) -> httpx.AsyncClient:
    """Create an httpx.AsyncClient with SSRF protection.

    Provides two layers of defense:
    - A request event hook that re-validates every URL (including redirect targets)
      against the private-network checks.
    - A custom transport that resolves DNS once, validates the IPs, and pins the
      connection to a validated public IP — preventing DNS-rebinding/TOCTOU where
      the connect-time resolution differs from the validation-time resolution.

    All keyword arguments are passed through to httpx.AsyncClient. A caller-supplied
    `transport` is respected (and assumed to provide its own SSRF handling).
    """
    event_hooks = kwargs.pop("event_hooks", {})
    request_hooks = list(event_hooks.get("request", []))
    request_hooks.append(_async_redirect_event_hook)
    event_hooks["request"] = request_hooks

    transport = kwargs.pop("transport", None)
    if transport is None:
        transport = _SSRFSafeTransport()

    return httpx.AsyncClient(
        event_hooks=event_hooks,
        transport=transport,
        **kwargs,
    )
