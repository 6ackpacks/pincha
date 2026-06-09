"""Pydantic schemas for curate v2 API endpoints."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel


# --- Channel schemas ---


class ChannelResponse(BaseModel):
    id: int
    slug: str
    name: str
    description: str | None = None
    icon: str | None = None
    pick_count: int = 5
    is_active: bool = True
    sort_order: int = 0
    is_subscribed: bool = False
    subscription_id: int | None = None

    model_config = {"from_attributes": True}


# --- Subscription schemas ---


class SubscriptionCreate(BaseModel):
    email_enabled: bool = False
    email_address: str | None = None
    site_enabled: bool = True


class SubscriptionUpdate(BaseModel):
    email_enabled: bool | None = None
    email_address: str | None = None
    site_enabled: bool | None = None


class SubscriptionResponse(BaseModel):
    id: int
    user_id: uuid.UUID
    channel_id: int
    email_enabled: bool
    email_address: str | None = None
    site_enabled: bool
    subscribed_at: datetime

    model_config = {"from_attributes": True}


# --- Daily Pick schemas ---


class DailyPickResponse(BaseModel):
    id: int
    channel_id: int
    pick_date: date
    rank: int
    source_type: str
    source_id: int
    title: str
    summary: str | None = None
    author_name: str | None = None
    author_avatar: str | None = None
    original_url: str
    published_at: datetime | None = None
    score: float | None = None
    is_official: bool = False
    article_id: uuid.UUID | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ChannelPicksResponse(BaseModel):
    channel: ChannelResponse
    picks: list[DailyPickResponse]
    pick_date: date


# --- Feed schemas ---


class FeedResponse(BaseModel):
    date: date
    channels: list[ChannelPicksResponse]


# --- Notification schemas ---


class NotificationResponse(BaseModel):
    id: int
    user_id: uuid.UUID
    pick_id: int
    is_read: bool
    created_at: datetime
    pick: DailyPickResponse | None = None

    model_config = {"from_attributes": True}


class UnreadCountResponse(BaseModel):
    count: int


# --- Deep analyze ---


class DeepAnalyzeRequest(BaseModel):
    pass  # No body needed, pick_id is in the URL


class DeepAnalyzeResponse(BaseModel):
    article_id: uuid.UUID
    status: str
    message: str
