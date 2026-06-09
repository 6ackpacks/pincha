from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel

SummaryLevel = Literal["express", "highlight", "detailed", "full"]


class SummaryResponse(BaseModel):
    id: uuid.UUID
    video_id: uuid.UUID
    level: SummaryLevel
    content: str
    model_used: str
    created_at: datetime
    cached: bool = False  # whether this was served from cache

    model_config = {"from_attributes": True, "protected_namespaces": ()}
