"""Wiki 子包共享依赖。"""

import uuid

from fastapi import Depends

from app.core.auth import get_current_user
from app.models.user import User


async def get_current_user_id(
    current_user: User = Depends(get_current_user),
) -> uuid.UUID:
    return current_user.id
