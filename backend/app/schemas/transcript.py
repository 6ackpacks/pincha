from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class TranscriptSegment(BaseModel):
    start: float
    end: float
    text: str


class TranscriptResponse(BaseModel):
    id: UUID
    video_id: UUID
    language: str
    source: str
    segments: list[TranscriptSegment]
    segments_en: list[TranscriptSegment | None] | None = None
    full_text: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class TranslateRequest(BaseModel):
    segment_indices: list[int]
    target_lang: str = "auto"


class TranslateResponse(BaseModel):
    video_id: UUID
    translations: dict[int, str]  # {segment_index: translated_text}
    from_cache: list[int]  # indices that were already cached
