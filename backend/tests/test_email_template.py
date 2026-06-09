"""Tests for XSS prevention in email template rendering.

Verifies that user-controlled inputs are properly HTML-escaped and that
dangerous URL protocols are blocked by _safe_url.
"""

import pytest

from app.services.curate_v2.email_template import (
    _safe_url,
    render_daily_digest_email,
)


class TestSafeUrl:
    """Tests for the _safe_url helper function."""

    def test_javascript_protocol_replaced_with_hash(self):
        """URL with javascript: protocol should be replaced with '#'."""
        assert _safe_url("javascript:alert(1)") == "#"

    def test_javascript_protocol_with_whitespace(self):
        """URL with leading whitespace + javascript: should be blocked."""
        assert _safe_url("  javascript:alert(document.cookie)") == "#"

    def test_data_protocol_replaced_with_hash(self):
        """URL with data: protocol should be replaced with '#'."""
        assert _safe_url("data:text/html,<script>alert(1)</script>") == "#"

    def test_https_url_passes_through_escaped(self):
        """Normal https:// URL should pass through but be HTML-escaped."""
        result = _safe_url("https://example.com/page?a=1&b=2")
        assert "https://example.com/page" in result
        # Ampersand should be escaped for safe HTML attribute embedding
        assert "&amp;" in result

    def test_http_url_passes_through(self):
        """Normal http:// URL should pass through."""
        result = _safe_url("http://example.com/unsubscribe")
        assert "http://example.com/unsubscribe" in result

    def test_url_with_quotes_escaped(self):
        """URL containing quotes should have them escaped."""
        result = _safe_url('https://example.com/page?x="hello"')
        assert '"' not in result or "&quot;" in result


class TestEmailTemplateXSS:
    """Tests for XSS prevention in render_daily_digest_email."""

    def test_user_name_script_injection_escaped(self):
        """user_name containing <script> tag should be HTML-escaped in output."""
        html_output = render_daily_digest_email(
            user_name='<script>alert(1)</script>',
            pick_date="5月12日",
            channels_picks={},
            unsubscribe_url="https://example.com/unsub",
        )
        # The raw script tag must NOT appear in the output
        assert "<script>" not in html_output
        # The escaped version should be present
        assert "&lt;script&gt;" in html_output

    def test_title_attribute_injection_escaped(self):
        """title with attribute injection attempt should be escaped."""
        html_output = render_daily_digest_email(
            user_name="Normal User",
            pick_date="5月12日",
            channels_picks={
                "TestChannel": [
                    {
                        "title": '" onmouseover="fetch(evil)"',
                        "summary": "safe summary",
                        "original_url": "https://example.com/article",
                    }
                ]
            },
            unsubscribe_url="https://example.com/unsub",
        )
        # The raw attribute injection must not appear unescaped
        assert 'onmouseover="fetch(evil)"' not in html_output
        # Should be escaped
        assert "&quot;" in html_output

    def test_pick_date_injection_escaped(self):
        """pick_date with HTML injection should be escaped."""
        html_output = render_daily_digest_email(
            user_name="User",
            pick_date='<img src=x onerror="alert(1)">',
            channels_picks={},
            unsubscribe_url="https://example.com/unsub",
        )
        assert "<img " not in html_output
        assert "&lt;img" in html_output

    def test_javascript_unsubscribe_url_blocked(self):
        """javascript: protocol in unsubscribe_url should be replaced with '#'."""
        html_output = render_daily_digest_email(
            user_name="User",
            pick_date="5月12日",
            channels_picks={},
            unsubscribe_url="javascript:alert(document.cookie)",
        )
        assert "javascript:" not in html_output
        # The href should be '#'
        assert 'href="#"' in html_output

    def test_channel_name_injection_escaped(self):
        """Channel name with HTML injection should be escaped."""
        html_output = render_daily_digest_email(
            user_name="User",
            pick_date="5月12日",
            channels_picks={
                '<b onmouseover="evil()">XSS</b>': [
                    {
                        "title": "Normal Title",
                        "summary": "",
                        "original_url": "https://example.com",
                    }
                ]
            },
            unsubscribe_url="https://example.com/unsub",
        )
        assert 'onmouseover="evil()"' not in html_output
        assert "&lt;b" in html_output
