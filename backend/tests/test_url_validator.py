"""Tests for SSRF URL validation.

The url_validator module (app.core.url_validator) provides validate_url()
which blocks requests to internal/private networks, disallowed schemes, and
other unsafe targets. These tests document the expected security behavior.
"""
import socket
from unittest.mock import patch

import pytest
from app.core.url_validator import validate_url, SSRFError


def _fake_getaddrinfo_public(hostname, port, family=0, type=0, proto=0, flags=0):
    """Return a fake public IP for DNS resolution in tests."""
    return [
        (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("142.250.80.46", 0)),
    ]


class TestURLValidator:
    """SSRF protection: validate_url must reject dangerous URLs."""

    def test_allows_normal_https_url(self):
        with patch("app.core.url_validator.socket.getaddrinfo", _fake_getaddrinfo_public):
            validate_url("https://www.youtube.com/watch?v=abc123")

    def test_allows_normal_http_url(self):
        with patch("app.core.url_validator.socket.getaddrinfo", _fake_getaddrinfo_public):
            validate_url("http://example.com/feed.xml")

    def test_rejects_private_ip_127(self):
        with pytest.raises(SSRFError):
            validate_url("http://127.0.0.1/secret")

    def test_rejects_private_ip_10(self):
        with pytest.raises(SSRFError):
            validate_url("http://10.0.0.1/internal")

    def test_rejects_private_ip_172(self):
        with pytest.raises(SSRFError):
            validate_url("http://172.16.0.1/admin")

    def test_rejects_private_ip_192(self):
        with pytest.raises(SSRFError):
            validate_url("http://192.168.1.1/router")

    def test_rejects_localhost(self):
        with pytest.raises(SSRFError):
            validate_url("http://localhost/")

    def test_rejects_ipv6_loopback(self):
        with pytest.raises(SSRFError):
            validate_url("http://[::1]/")

    def test_rejects_ftp_scheme(self):
        with pytest.raises(SSRFError):
            validate_url("ftp://example.com/file")

    def test_rejects_file_scheme(self):
        with pytest.raises(SSRFError):
            validate_url("file:///etc/passwd")

    def test_rejects_empty_url(self):
        with pytest.raises(SSRFError):
            validate_url("")

    def test_rejects_zeabur_internal(self):
        with pytest.raises(SSRFError):
            validate_url("http://service-abc123:8080/api")

    def test_rejects_no_host(self):
        with pytest.raises(SSRFError):
            validate_url("http:///path")

    def test_rejects_dns_rebinding_to_private(self):
        """If DNS resolves a public hostname to a private IP, it must be blocked."""
        def _fake_resolve_private(*args, **kwargs):
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("192.168.1.1", 0))]

        with patch("app.core.url_validator.socket.getaddrinfo", _fake_resolve_private):
            with pytest.raises(SSRFError):
                validate_url("http://evil.attacker.com/steal")

    def test_rejects_metadata_endpoint(self):
        """Cloud metadata IP 169.254.169.254 must be blocked."""
        with pytest.raises(SSRFError):
            validate_url("http://169.254.169.254/latest/meta-data/")
