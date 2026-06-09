"""Test that xfyun_asr service does NOT disable SSL verification."""

import ast
import inspect
from unittest.mock import patch, AsyncMock, MagicMock
import pytest


class TestXfyunSSLVerification:
    """Ensure httpx.AsyncClient is never instantiated with verify=False."""

    def test_no_verify_false_in_source(self):
        """Static check: verify=False must not appear in xfyun_asr module source."""
        from app.services import xfyun_asr

        source = inspect.getsource(xfyun_asr)
        tree = ast.parse(source)

        for node in ast.walk(tree):
            if isinstance(node, ast.keyword):
                if node.arg == "verify" and isinstance(node.value, ast.Constant) and node.value.value is False:
                    pytest.fail(
                        "Found verify=False in xfyun_asr source code. "
                        "SSL verification must not be disabled."
                    )

    @pytest.mark.asyncio
    async def test_httpx_client_does_not_disable_ssl(self):
        """Runtime check: httpx.AsyncClient constructor must not receive verify=False."""
        captured_kwargs = {}

        class FakeAsyncClient:
            def __init__(self, **kwargs):
                captured_kwargs.update(kwargs)

            async def __aenter__(self):
                mock_client = AsyncMock()
                mock_response = MagicMock()
                mock_response.status_code = 200
                mock_response.json.return_value = {
                    "code": "000000",
                    "content": {"orderId": "fake-order", "taskEstimateTime": 100},
                }
                mock_client.post.return_value = mock_response
                return mock_client

            async def __aexit__(self, *args):
                pass

        env_vars = {
            "XFYUN_APP_ID": "fake_app_id",
            "XFYUN_ACCESS_KEY_ID": "fake_key_id",
            "XFYUN_API_SECRET": "fake_secret",
        }

        with patch("app.services.xfyun_asr.httpx.AsyncClient", FakeAsyncClient):
            with patch("app.services.xfyun_asr.settings") as mock_settings:
                mock_settings.XFYUN_APP_ID = env_vars["XFYUN_APP_ID"]
                mock_settings.XFYUN_ACCESS_KEY_ID = env_vars["XFYUN_ACCESS_KEY_ID"]
                mock_settings.XFYUN_API_SECRET = env_vars["XFYUN_API_SECRET"]
                with patch("os.path.exists", return_value=True):
                    with patch("os.path.getsize", return_value=1024):
                        with patch("builtins.open", MagicMock()):
                            with patch("app.services.xfyun_asr._get_wav_duration_ms", return_value=5000):
                                from app.services.xfyun_asr import transcribe_audio
                                try:
                                    await transcribe_audio("/fake/path.wav")
                                except Exception:
                                    pass

        # The critical assertion: verify must not be False
        assert captured_kwargs.get("verify", True) is not False, (
            "httpx.AsyncClient must not disable SSL verification (verify=False)"
        )

    def test_ssl_verify_not_explicitly_false(self):
        """Verify that the 'verify' kwarg is either absent or True (never False)."""
        from app.services import xfyun_asr

        source = inspect.getsource(xfyun_asr)

        # Simple string check as additional safety net
        assert "verify=False" not in source, (
            "Found 'verify=False' string in xfyun_asr source. "
            "SSL verification must remain enabled."
        )
