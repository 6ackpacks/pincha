"""Notification and email digest service for curate v2.

Creates notification records for subscribers and sends email digests.
Designed to run in sync Celery task context.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from urllib.parse import urlparse

import resend
from sqlalchemy import select, text
from sqlalchemy.engine import Engine

from app.config import settings

logger = logging.getLogger(__name__)


def create_notifications(pick_date: date, engine: Engine) -> int:
    """
    Create notification records for all subscribers of channels with picks on pick_date.

    For each channel's picks, find all subscribers (site_enabled=True)
    and create notification rows.

    Returns count of notifications created.
    """
    from app.models.curate_v2 import CurateDailyPick, CurateNotification, CurateSubscription

    count = 0

    with engine.connect() as conn:
        # Get all picks for the date
        picks_result = conn.execute(
            text("""
                SELECT id, channel_id
                FROM curate_daily_picks
                WHERE pick_date = :pick_date
            """),
            {"pick_date": pick_date},
        )
        picks = picks_result.fetchall()

        if not picks:
            logger.info("No picks found for %s, skipping notifications", pick_date)
            return 0

        # Get channel_ids that have picks
        channel_ids = list({row.channel_id for row in picks})

        # Get all subscribers for these channels (site_enabled)
        subs_result = conn.execute(
            text("""
                SELECT user_id, channel_id
                FROM curate_subscriptions
                WHERE channel_id = ANY(:channel_ids)
                AND site_enabled = TRUE
            """),
            {"channel_ids": channel_ids},
        )
        subscriptions = subs_result.fetchall()

        if not subscriptions:
            logger.info("No subscribers found for channels with picks on %s", pick_date)
            return 0

        # Build lookup: channel_id -> list of pick_ids
        channel_picks: dict[int, list[int]] = {}
        for row in picks:
            channel_picks.setdefault(row.channel_id, []).append(row.id)

        # Create notification records
        notifications_to_insert = []
        for sub in subscriptions:
            pick_ids = channel_picks.get(sub.channel_id, [])
            for pick_id in pick_ids:
                notifications_to_insert.append({
                    "user_id": str(sub.user_id),
                    "pick_id": pick_id,
                    "is_read": False,
                })

        if notifications_to_insert:
            # Batch insert, skip duplicates
            conn.execute(
                text("""
                    INSERT INTO curate_notifications (user_id, pick_id, is_read, created_at)
                    VALUES (:user_id, :pick_id, :is_read, NOW())
                    ON CONFLICT DO NOTHING
                """),
                notifications_to_insert,
            )
            conn.commit()
            count = len(notifications_to_insert)

    logger.info("Created %d notifications for %s", count, pick_date)
    return count


def send_email_digests(pick_date: date, engine: Engine) -> int:
    """
    Send merged email to users who have email_enabled=True.
    One email per user containing all their subscribed channels' picks.

    Uses Resend API (resend.api_key = settings.RESEND_API_KEY).
    Email subject: "品猹每日精选 · {M}月{D}日"

    Returns count of emails sent.
    """
    from .email_template import render_daily_digest_email

    if not settings.RESEND_API_KEY:
        logger.warning("RESEND_API_KEY not configured, skipping email digests")
        return 0

    resend.api_key = settings.RESEND_API_KEY
    sender_domain = urlparse(settings.FRONTEND_URL).hostname or "pingcha.app"
    sent = 0

    with engine.connect() as conn:
        # Get users with email-enabled subscriptions
        users_result = conn.execute(
            text("""
                SELECT DISTINCT s.user_id,
                       COALESCE(s.email_address, u.email) as email,
                       u.nickname
                FROM curate_subscriptions s
                JOIN users u ON u.id = s.user_id
                WHERE s.email_enabled = TRUE
                AND COALESCE(s.email_address, u.email) IS NOT NULL
                AND COALESCE(s.email_address, u.email) != ''
            """),
        )
        users = users_result.fetchall()

        if not users:
            logger.info("No users with email-enabled subscriptions")
            return 0

        # Get all picks for the date with channel info
        picks_result = conn.execute(
            text("""
                SELECT p.id, p.channel_id, p.title, p.summary, p.original_url, p.rank,
                       c.name as channel_name, c.slug as channel_slug
                FROM curate_daily_picks p
                JOIN curate_channels c ON c.id = p.channel_id
                WHERE p.pick_date = :pick_date
                ORDER BY c.sort_order, p.rank
            """),
            {"pick_date": pick_date},
        )
        all_picks = picks_result.fetchall()

        if not all_picks:
            logger.info("No picks for %s, skipping email digests", pick_date)
            return 0

        # Build channel_id -> picks mapping
        picks_by_channel: dict[int, list[dict]] = {}
        channel_names: dict[int, str] = {}
        for row in all_picks:
            channel_id = row.channel_id
            channel_names[channel_id] = row.channel_name
            picks_by_channel.setdefault(channel_id, []).append({
                "title": row.title,
                "summary": row.summary or "",
                "original_url": row.original_url,
            })

        # For each user, get their subscribed channels and send email
        for user_row in users:
            user_id = user_row.user_id
            email = user_row.email
            nickname = user_row.nickname or "用户"

            # Get user's email-enabled channel subscriptions
            user_subs_result = conn.execute(
                text("""
                    SELECT channel_id
                    FROM curate_subscriptions
                    WHERE user_id = :user_id
                    AND email_enabled = TRUE
                """),
                {"user_id": str(user_id)},
            )
            user_channel_ids = [row.channel_id for row in user_subs_result.fetchall()]

            # Build email content
            channels_picks: dict[str, list[dict]] = {}
            for ch_id in user_channel_ids:
                if ch_id in picks_by_channel:
                    ch_name = channel_names.get(ch_id, "未知频道")
                    channels_picks[ch_name] = picks_by_channel[ch_id]

            if not channels_picks:
                continue

            # Render and send
            date_str = f"{pick_date.month}月{pick_date.day}日"
            unsubscribe_url = f"{settings.FRONTEND_URL}/settings/subscriptions"

            html_body = render_daily_digest_email(
                user_name=nickname,
                pick_date=date_str,
                channels_picks=channels_picks,
                unsubscribe_url=unsubscribe_url,
                frontend_url=settings.FRONTEND_URL,
            )

            try:
                resend.Emails.send({
                    "from": f"品猹每日精选 <digest@{sender_domain}>",
                    "to": email,
                    "subject": f"品猹每日精选 · {date_str}",
                    "html": html_body,
                })
                sent += 1
            except Exception as e:
                logger.error("Failed to send digest to %s: %s", email, e)

    logger.info("Sent %d email digests for %s", sent, pick_date)
    return sent
