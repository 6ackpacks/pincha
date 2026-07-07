"""Local single-user identity endpoints."""

from fastapi import APIRouter, Depends

from app.core.auth import get_current_user
from app.models.user import User

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/me")
async def get_me(user: User = Depends(get_current_user)):
    """Return the automatically initialized Local Owner."""
    return {
        "id": str(user.id),
        "nickname": user.nickname,
        "avatar_url": user.avatar_url,
        "email": user.email,
        "phone": user.phone,
        "is_admin": user.is_admin,
    }
