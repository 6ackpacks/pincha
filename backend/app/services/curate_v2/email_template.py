"""Daily digest email template for Curate V2 subscriptions."""

import html


def _safe_url(url: str) -> str:
    """URL 协议白名单检查，只允许 http:// 和 https://，防止 javascript: 注入。"""
    stripped = url.strip()
    if stripped.startswith(("http://", "https://")):
        return html.escape(stripped, quote=True)
    return "#"


def render_daily_digest_email(
    user_name: str,
    pick_date: str,
    channels_picks: dict[str, list[dict]],
    unsubscribe_url: str,
    frontend_url: str = "https://pingcha.app",
) -> str:
    """
    Render HTML email for the daily digest.

    Args:
        user_name: Display name of the recipient.
        pick_date: Human-readable date string, e.g. "5月12日".
        channels_picks: Mapping of channel_name -> list of pick dicts.
            Each pick dict should have: title, summary, original_url.
        unsubscribe_url: One-click unsubscribe link.
        frontend_url: Base URL of the frontend app.

    Returns:
        Complete HTML string ready to send as email body.
    """
    channels_html = _render_channels(channels_picks)
    curate_url = f"{html.escape(frontend_url, quote=True)}/curate"

    # 转义用户可控字段，防止 XSS
    safe_user_name = html.escape(user_name)
    safe_pick_date = html.escape(pick_date)
    safe_unsubscribe_url = _safe_url(unsubscribe_url)

    return f"""\
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>品猹每日精选 · {safe_pick_date}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;">
<tr><td align="center" style="padding:40px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;">

<!-- Header -->
<tr><td style="padding:32px 32px 24px;border-bottom:1px solid #e4e4e7;">
<h1 style="margin:0;font-size:22px;font-weight:700;color:#1a1a1a;line-height:1.3;">
品猹每日精选 · {safe_pick_date}
</h1>
</td></tr>

<!-- Greeting -->
<tr><td style="padding:24px 32px 8px;">
<p style="margin:0;font-size:15px;color:#3f3f46;line-height:1.6;">
Hi {safe_user_name}，以下是你订阅频道的今日精选：
</p>
</td></tr>

<!-- Channel picks -->
{channels_html}

<!-- CTA -->
<tr><td style="padding:24px 32px 32px;">
<table role="presentation" cellpadding="0" cellspacing="0">
<tr><td style="background-color:#6366f1;border-radius:8px;">
<a href="{curate_url}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">
在品猹查看更多
</a>
</td></tr>
</table>
</td></tr>

<!-- Footer -->
<tr><td style="padding:24px 32px;border-top:1px solid #e4e4e7;background-color:#fafafa;">
<p style="margin:0 0 8px;font-size:12px;color:#a1a1aa;line-height:1.5;">
品猹 · 让 AI 内容触手可及
</p>
<p style="margin:0;font-size:12px;color:#a1a1aa;line-height:1.5;">
<a href="{safe_unsubscribe_url}" style="color:#6366f1;text-decoration:underline;">退订</a>
</p>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>"""


def _render_channels(channels_picks: dict[str, list[dict]]) -> str:
    """Render all channel sections."""
    sections: list[str] = []
    for channel_name, picks in channels_picks.items():
        picks_html = _render_picks(picks)
        safe_channel_name = html.escape(channel_name)
        section = f"""\
<tr><td style="padding:20px 32px 4px;">
<h2 style="margin:0;font-size:16px;font-weight:600;color:#1a1a1a;line-height:1.4;border-left:3px solid #6366f1;padding-left:10px;">
{safe_channel_name}
</h2>
</td></tr>
{picks_html}"""
        sections.append(section)
    return "\n".join(sections)


def _render_picks(picks: list[dict]) -> str:
    """Render a list of picks for one channel."""
    rows: list[str] = []
    for pick in picks:
        title = html.escape(pick.get("title", ""))
        summary = html.escape(pick.get("summary", ""))
        url = _safe_url(pick.get("original_url", "#"))
        summary_html = (
            f'<p style="margin:4px 0 0;font-size:13px;color:#71717a;line-height:1.5;">{summary}</p>'
            if summary
            else ""
        )
        row = f"""\
<tr><td style="padding:8px 32px 8px 45px;">
<a href="{url}" style="font-size:14px;font-weight:500;color:#6366f1;text-decoration:none;line-height:1.4;">
{title}
</a>
{summary_html}
</td></tr>"""
        rows.append(row)
    return "\n".join(rows)
