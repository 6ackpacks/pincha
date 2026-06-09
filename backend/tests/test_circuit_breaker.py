"""熔断器 (Circuit Breaker) 单元测试.

验证 _CircuitBreaker 在连续失败、成功重置、超时恢复等场景下的行为。
"""

from unittest.mock import patch

import pytest


class TestCircuitBreaker:
    """熔断器 (Circuit Breaker) 单元测试."""

    def test_circuit_opens_after_threshold(self):
        """连续失败达到阈值后熔断器打开."""
        from app.services.subtitle_service import _CircuitBreaker

        breaker = _CircuitBreaker(failure_threshold=3, recovery_timeout=60.0)
        assert not breaker.is_open("test_provider")

        breaker.record_failure("test_provider")
        breaker.record_failure("test_provider")
        assert not breaker.is_open("test_provider")

        breaker.record_failure("test_provider")
        assert breaker.is_open("test_provider")

    def test_circuit_resets_on_success(self):
        """成功调用后熔断器计数器重置."""
        from app.services.subtitle_service import _CircuitBreaker

        breaker = _CircuitBreaker(failure_threshold=3, recovery_timeout=60.0)

        breaker.record_failure("test_provider")
        breaker.record_failure("test_provider")
        breaker.record_success("test_provider")
        breaker.record_failure("test_provider")

        # Should not trip because success reset the counter
        assert not breaker.is_open("test_provider")

    @patch("time.monotonic")
    def test_circuit_recovers_after_timeout(self, mock_time):
        """超时恢复后熔断器关闭."""
        from app.services.subtitle_service import _CircuitBreaker

        breaker = _CircuitBreaker(failure_threshold=2, recovery_timeout=30.0)

        mock_time.return_value = 0.0
        breaker.record_failure("test_provider")
        breaker.record_failure("test_provider")
        assert breaker.is_open("test_provider")

        # After recovery timeout passes
        mock_time.return_value = 31.0
        assert not breaker.is_open("test_provider")
