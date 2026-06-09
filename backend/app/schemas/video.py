from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, HttpUrl


class VideoCreate(BaseModel):
    url: HttpUrl
    platform: Literal["youtube", "podcast"]


class VideoProgress(BaseModel):
    state: str
    progress: int
    message: str = ""


class VideoResponse(BaseModel):
    id: uuid.UUID
    url: str
    platform: str
    title: str | None = None
    thumbnail_url: str | None = None
    duration: str | None = None
    status: VideoProgress
    in_wiki: bool = False
    show_name: str | None = None
    host: str | None = None
    description: str | None = None
    created_at: datetime
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}
