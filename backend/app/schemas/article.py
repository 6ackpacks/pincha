from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, HttpUrl, model_validator


class ArticleCreate(BaseModel):
    url: HttpUrl | None = Field(default=None, max_length=2048)
    content: str | None = Field(default=None, max_length=100000)

    @model_validator(mode="after")
    def check_url_or_content(self):
        if not self.url and not self.content:
            raise ValueError("url or content must be provided")
        return self


class ArticleProgress(BaseModel):
    state: str
    progress: int
    message: str = ""


class ArticleResponse(BaseModel):
    id: uuid.UUID
    source_type: str
    source_url: str | None = None
    title: str | None = None
    author: str | None = None
    thumbnail_url: str | None = None
    word_count: int | None = None
    language: str | None = None
    status: ArticleProgress
    in_wiki: bool = False
    created_at: datetime
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}


ArticleSummaryLevel = Literal["express", "highlight", "detailed", "full"]


class ArticleSummaryResponse(BaseModel):
    id: uuid.UUID
    article_id: uuid.UUID
    level: ArticleSummaryLevel
    content: str
    model_used: str
    created_at: datetime
    cached: bool = False

    model_config = {"from_attributes": True, "protected_namespaces": ()}


class ArticleMindmapResponse(BaseModel):
    id: uuid.UUID
    article_id: uuid.UUID
    markdown: str
    model_used: str
    created_at: datetime
    cached: bool = False

    model_config = {"from_attributes": True, "protected_namespaces": ()}
