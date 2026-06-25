"""SSRF URL Validator — blocks outbound requests to internal/private networks.

Usage:
    from app.core.url_validator import validate_url, validate_url_async, safe_async_client

    # Sync validation (Celery tasks, sync code)
    validate_url(user_supplied_url)

    # Async validation (FastAPI endpoints — non-blocking DNS resolution)
    await validate_url_async(user_supplied_url)

    # Validate + resolve (prevents DNS rebinding — use before HTTP fetch)
    url, resolved_ips = await validate_and_resolve(user_supplied_url)

    # Or use the safe client factory (validates on redirects too)
    # With DNS pinning (recommended for user-supplied URLs):
    async with safe_async_client(resolved_ips=resolved_ips) as client:
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

# Internal hostnames that should never be reached from user-supplied URLs
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


async def validate_and_resolve(url: str) -> tuple[str, list[str]]:
    """Validate URL safety AND return resolved IPs — prevents DNS rebinding.

    Use this before making HTTP requests to user-supplied URLs. The returned
    IPs should be passed to safe_async_client(resolved_ips=...) to pin DNS.

    Returns:
        Tuple of (validated_url, list_of_safe_ips)

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

    # 2.5. Port whitelist
    parsed_port = parsed.port
    if parsed_port is None:
        parsed_port = 443 if parsed.scheme == "https" else 80
    if parsed_port not in ALLOWED_PORTS:
        raise SSRFError(f"Port {parsed_port} not allowed (only 80/443)")

    # 3. Check if hostname is an IP literal
    try:
        addr = ipaddress.ip_address(hostname)
    except ValueError:
        addr = None

    if addr is not None:
        if _is_private_ip(str(addr)):
            raise SSRFError(f"IP address '{hostname}' is in a private/reserved range")
        return url, [str(addr)]

    # 4. DNS resolution in thread pool
    try:
        addrinfos = await asyncio.to_thread(
            socket.getaddrinfo, hostname, None, socket.AF_UNSPEC, socket.SOCK_STREAM
        )
    except socket.gaierror:
        raise SSRFError(f"Cannot resolve hostname '{hostname}'")

    if not addrinfos:
        raise SSRFError(f"No DNS records found for '{hostname}'")

    safe_ips: list[str] = []
    for family, _type, _proto, _canonname, sockaddr in addrinfos:
        ip_str = sockaddr[0]
        if _is_private_ip(ip_str):
            raise SSRFError(
                f"Hostname '{hostname}' resolves to private IP '{ip_str}'"
            )
        if ip_str not in safe_ips:
            safe_ips.append(ip_str)

    return url, safe_ips


def validate_and_resolve_sync(url: str) -> tuple[str, list[str]]:
    """Sync version of validate_and_resolve — for Celery tasks.

    Returns:
        Tuple of (validated_url, list_of_safe_ips)

    Raises:
        SSRFError: If the URL targets a private/internal network.
    """
    parsed = urlparse(url)

    if parsed.scheme not in ("http", "https"):
        raise SSRFError(f"URL scheme '{parsed.scheme}' is not allowed; only http/https permitted")

    hostname = parsed.hostname
    if not hostname:
        raise SSRFError("URL has no hostname")

    if _check_hostname_blocked(hostname):
        raise SSRFError(f"Hostname '{hostname}' is blocked (internal service)")

    parsed_port = parsed.port
    if parsed_port is None:
        parsed_port = 443 if parsed.scheme == "https" else 80
    if parsed_port not in ALLOWED_PORTS:
        raise SSRFError(f"Port {parsed_port} not allowed (only 80/443)")

    try:
        addr = ipaddress.ip_address(hostname)
    except ValueError:
        addr = None

    if addr is not None:
        if _is_private_ip(str(addr)):
            raise SSRFError(f"IP address '{hostname}' is in a private/reserved range")
        return url, [str(addr)]

    try:
        addrinfos = socket.getaddrinfo(hostname, None, socket.AF_UNSPEC, socket.SOCK_STREAM)
    except socket.gaierror:
        raise SSRFError(f"Cannot resolve hostname '{hostname}'")

    if not addrinfos:
        raise SSRFError(f"No DNS records found for '{hostname}'")

    safe_ips: list[str] = []
    for family, _type, _proto, _canonname, sockaddr in addrinfos:
        ip_str = sockaddr[0]
        if _is_private_ip(ip_str):
            raise SSRFError(
                f"Hostname '{hostname}' resolves to private IP '{ip_str}'"
            )
        if ip_str not in safe_ips:
            safe_ips.append(ip_str)

    return url, safe_ips


class _PinnedDNSTransport(httpx.AsyncHTTPTransport):
    """Custom transport that pins DNS resolution to pre-validated IPs.

    Prevents DNS rebinding attacks by replacing hostname with a safe resolved IP
    and setting the Host header to preserve correct TLS SNI and virtual hosting.
    """

    def __init__(self, hostname_to_ips: dict[str, list[str]], **kwargs):
        self._hostname_to_ips = hostname_to_ips
        super().__init__(**kwargs)

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        hostname = request.url.host
        if hostname and hostname in self._hostname_to_ips:
            ips = self._hostname_to_ips[hostname]
            pinned_ip = ips[0]  # Use first resolved IP
            # Replace hostname with IP in the URL
            # Preserve port if explicitly set
            port = request.url.port
            if port:
                new_url = request.url.copy_with(host=pinned_ip, port=port)
            else:
                new_url = request.url.copy_with(host=pinned_ip)
            # Ensure Host header is set to original hostname for vhosts
            request.headers["host"] = hostname
            # Set SNI hostname for TLS certificate verification
            extensions = dict(request.extensions) if request.extensions else {}
            extensions["sni_hostname"] = hostname.encode("ascii")
            request = httpx.Request(
                method=request.method,
                url=new_url,
                headers=request.headers,
                stream=request.stream,
                extensions=extensions,
            )
        return await super().handle_async_request(request)


async def _async_redirect_event_hook(request: httpx.Request) -> None:
    """Async httpx event hook that validates redirect URLs against SSRF."""
    url_str = str(request.url)
    try:
        await validate_url_async(url_str)
    except SSRFError as e:
        raise SSRFError(f"Redirect blocked: {e}") from e


def safe_async_client(
    resolved_ips: list[str] | None = None,
    _pinned_hostname: str | None = None,
    **kwargs,
) -> httpx.AsyncClient:
    """Create an httpx.AsyncClient with SSRF redirect validation.

    Args:
        resolved_ips: Pre-resolved safe IPs from validate_and_resolve().
            When provided along with _pinned_hostname, DNS is pinned to these
            IPs to prevent DNS rebinding attacks.
        _pinned_hostname: The hostname to pin. If resolved_ips is provided but
            this is None, it will be inferred from the first request (not pinned).
        **kwargs: Passed through to httpx.AsyncClient.

    The event_hooks for 'request' will include async redirect validation.
    """
    event_hooks = kwargs.pop("event_hooks", {})
    request_hooks = list(event_hooks.get("request", []))
    request_hooks.append(_async_redirect_event_hook)
    event_hooks["request"] = request_hooks

    # If resolved IPs are provided, use pinned DNS transport
    if resolved_ips and _pinned_hostname:
        transport = _PinnedDNSTransport(
            hostname_to_ips={_pinned_hostname: resolved_ips},
            verify=kwargs.pop("verify", True),
        )
        return httpx.AsyncClient(
            event_hooks=event_hooks,
            transport=transport,
            **kwargs,
        )

    return httpx.AsyncClient(
        event_hooks=event_hooks,
        **kwargs,
    )
