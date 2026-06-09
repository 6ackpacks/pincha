"""Tests for SSRF protection in podcast_audio_service.py.

Verifies that validate_url_async blocks requests to private/internal IPs
while allowing public URLs through.
"""

import pytest
from unittest.mock import patch, AsyncMock

from app.core.url_validator import validate_url_async, SSRFError


class TestPodcastSSRFProtection:
    """SSRF protection tests for podcast audio download URLs."""

    @pytest.mark.asyncio
    async def test_private_metadata_ip_raises_ssrf_error(self):
        """URL targeting cloud metadata IP (169.254.169.254) should raise SSRFError."""
        with pytest.raises(SSRFError):
            await validate_url_async("http://169.254.169.254/latest/meta-data/")

    @pytest.mark.asyncio
    async def test_localhost_raises_ssrf_error(self):
        """URL targeting localhost (127.0.0.1) should raise SSRFError."""
        with pytest.raises(SSRFError):
            await validate_url_async("http://127.0.0.1:6379/")

    @pytest.mark.asyncio
    async def test_localhost_hostname_raises_ssrf_error(self):
        """URL targeting 'localhost' hostname should raise SSRFError."""
        # localhost resolves to 127.0.0.1 which is loopback/private
        with patch("asyncio.to_thread") as mock_to_thread:
            import socket
            # Simulate DNS resolution of localhost → 127.0.0.1
            mock_to_thread.return_value = [
                (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 0))
            ]
            with pytest.raises(SSRFError):
                await validate_url_async("http://localhost:6379/")

    @pytest.mark.asyncio
    async def test_internal_ip_10_range_raises_ssrf_error(self):
        """URL targeting 10.x.x.x private range should raise SSRFError."""
        with pytest.raises(SSRFError):
            await validate_url_async("http://10.0.0.1/internal")

    @pytest.mark.asyncio
    async def test_public_url_does_not_raise(self):
        """Normal public URL should not raise SSRFError from validate_url."""
        # Mock DNS resolution to return a public IP
        with patch("asyncio.to_thread") as mock_to_thread:
            import socket
            mock_to_thread.return_value = [
                (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 0))
            ]
            # Should not raise
            await validate_url_async("https://example.com/podcast.mp3")

    @pytest.mark.asyncio
    async def test_non_http_scheme_raises_ssrf_error(self):
        """URL with non-http scheme (e.g., file://) should raise SSRFError."""
        with pytest.raises(SSRFError):
            await validate_url_async("file:///etc/passwd")

    @pytest.mark.asyncio
    async def test_download_with_http_calls_validate(self):
        """_download_with_http should call validate_url_async before fetching."""
        from app.services.podcast_audio_service import _download_with_http

        with pytest.raises(SSRFError):
            await _download_with_http("http://169.254.169.254/latest/meta-data/")

    @pytest.mark.asyncio
    async def test_download_with_ytdlp_calls_validate(self):
        """_download_with_ytdlp should call validate_url_async before downloading."""
        from app.services.podcast_audio_service import _download_with_ytdlp

        with pytest.raises(SSRFError):
            await _download_with_ytdlp("http://127.0.0.1:8080/audio.mp3")
