from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel


class MindmapResponse(BaseModel):
    id: uuid.UUID
    video_id: uuid.UUID
    markdown: str
    model_used: str
    created_at: datetime
    cached: bool = False

    model_config = {"from_attributes": True, "protected_namespaces": ()}
