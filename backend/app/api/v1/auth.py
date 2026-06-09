"""观猹 OAuth2 login, callback, session endpoints."""
import logging
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode, quote

logger = logging.getLogger(__name__)

import httpx
from fastapi import APIRouter, Cookie, Depends, Query, Request, Response
from fastapi.responses import RedirectResponse
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.auth import blacklist_token, create_session_token, get_current_user, invalidate_user_cache
from app.core.database import get_session
from app.core.rate_limit import limiter
from app.core.redis import get_redis
from app.models.user import User

router = APIRouter(prefix="/auth", tags=["auth"])

_IS_HTTPS = settings.APP_ENV != "development"
_COOKIE_KWARGS = {
    "httponly": True,
    "samesite": "lax",
    "secure": _IS_HTTPS,
    "path": "/",
}

_WATCHA_AUTH_URL = "https://watcha.cn/oauth/authorize"
_WATCHA_TOKEN_URL = "https://watcha.cn/oauth/api/token"
_WATCHA_USERINFO_URL = "https://watcha.cn/oauth/api/userinfo"

_COOKIE_MAX_AGE = 60 * 60 * 24 * 7  # 7 days
_STATE_TTL = 600  # 10 minutes

_LOGIN_ERROR_URL = f"{settings.FRONTEND_URL}/login?error="
_HTTPX_KWARGS: dict = {"timeout": 30}
if settings.WATCHA_PROXY_URL:
    _HTTPX_KWARGS["proxy"] = settings.WATCHA_PROXY_URL


def _error_redirect(msg: str) -> RedirectResponse:
    """Redirect to login page with error message."""
    return RedirectResponse(url=f"{_LOGIN_ERROR_URL}{quote(msg)}", status_code=302)


@router.get("/login")
@limiter.limit("20/minute")
async def login(request: Request):
    """Redirect browser to Watcha OAuth authorization page."""
    state = secrets.token_urlsafe(32)
    # Store state in Redis (cookie may not survive Next.js rewrite proxy)
    redis = await get_redis()
    await redis.set(f"oauth:state:{state}", "1", ex=_STATE_TTL)

    params = urlencode(
        {
            "response_type": "code",
            "client_id": settings.WATCHA_CLIENT_ID,
            "redirect_uri": settings.WATCHA_REDIRECT_URI,
            "scope": "read",
            "state": state,
        },
        quote_via=quote,
    )
    return RedirectResponse(url=f"{_WATCHA_AUTH_URL}?{params}")


@router.get("/callback")
@limiter.limit("20/minute")
async def callback(
    request: Request,
    code: str = Query(...),
    state: str = Query(""),
    db: AsyncSession = Depends(get_session),
):
    """Exchange authorization code, upsert user, set session cookie."""
    # 0. Verify CSRF state via Redis
    redis = await get_redis()
    state_key = f"oauth:state:{state}"
    valid = await redis.get(state_key)
    if not state or not valid:
        logger.warning("OAuth state 校验失败: state=%s valid=%s", state[:8] if state else "empty", valid)
        return _error_redirect("状态校验失败，请重新登录")
    await redis.delete(state_key)

    try:
        # 1. Exchange code for Watcha access token
        async with httpx.AsyncClient(**_HTTPX_KWARGS) as client:
            token_resp = await client.post(
                _WATCHA_TOKEN_URL,
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": settings.WATCHA_REDIRECT_URI,
                    "client_id": settings.WATCHA_CLIENT_ID,
                    "client_secret": settings.WATCHA_CLIENT_SECRET,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )

        if token_resp.status_code != 200:
            logger.error("观猹 token 交换失败: status=%d body=%s", token_resp.status_code, token_resp.text[:500])
            return _error_redirect("授权码交换失败")
        token_data = token_resp.json()
        logger.info("观猹 token 交换成功: access_token=%s, refresh_token=%s",
                    "present" if token_data.get("access_token") else "missing",
                    "present" if token_data.get("refresh_token") else "missing")
        if "error" in token_data:
            return _error_redirect(
                token_data.get("error_description", "授权失败")
            )

        watcha_access_token = token_data.get("access_token", "")
        if not watcha_access_token:
            logger.error("观猹 token 交换成功但 access_token 为空: keys=%s", list(token_data.keys()))
            return _error_redirect("授权令牌为空，请重试")
        watcha_refresh_token = token_data.get("refresh_token")
        expires_in = token_data.get("expires_in", 1800)
        token_expires_at = datetime.now(timezone.utc) + timedelta(seconds=expires_in)

        # 2. Fetch user info from Watcha (观猹不接受 Bearer header，需用 query param)
        async with httpx.AsyncClient(**_HTTPX_KWARGS) as client:
            info_resp = await client.get(
                _WATCHA_USERINFO_URL,
                params={"access_token": watcha_access_token},
            )

        if info_resp.status_code != 200:
            logger.error("观猹 userinfo 失败: status=%d body=%s", info_resp.status_code, info_resp.text[:500])
            return _error_redirect("获取用户信息失败")
        info_body = info_resp.json()

        # 兼容两种响应格式：
        # 格式 A: {"statusCode": 200, "data": {...}}
        # 格式 B: 直接返回用户对象 {"user_id": ..., "nickname": ...}
        if "data" in info_body and isinstance(info_body["data"], dict):
            if info_body.get("statusCode") and info_body["statusCode"] != 200:
                return _error_redirect(
                    info_body.get("message", "获取用户信息失败")
                )
            data = info_body["data"]
        elif "user_id" in info_body:
            data = info_body
        else:
            logger.error("观猹 userinfo 响应格式未知: %s", str(info_body)[:500])
            return _error_redirect("获取用户信息失败")

        watcha_user_id: int = data["user_id"]
        nickname: str = data.get("nickname") or data.get("name") or f"用户{watcha_user_id}"
        avatar_url: str | None = data.get("avatar_url") or data.get("avatar")
        email: str | None = data.get("email")
        phone: str | None = data.get("phone")

        # 3. Upsert user in our DB
        result = await db.execute(
            select(User).where(User.watcha_user_id == watcha_user_id)
        )
        user = result.scalar_one_or_none()

        if user is None:
            user = User(
                watcha_user_id=watcha_user_id,
                nickname=nickname,
                avatar_url=avatar_url,
                email=email,
                phone=phone,
                watcha_access_token=watcha_access_token,
                watcha_refresh_token=watcha_refresh_token,
                watcha_token_expires_at=token_expires_at,
            )
            db.add(user)
            await db.flush()
            # Auto-create default knowledge base for new user
            from app.models.knowledge_base import KnowledgeBase
            default_kb = KnowledgeBase(user_id=user.id, name="默认知识库", is_default=True)
            db.add(default_kb)
        else:
            user.nickname = nickname
            if avatar_url:
                user.avatar_url = avatar_url
            if email:
                user.email = email
            if phone:
                user.phone = phone
            user.watcha_access_token = watcha_access_token
            user.watcha_refresh_token = watcha_refresh_token
            user.watcha_token_expires_at = token_expires_at

        await db.commit()
        await db.refresh(user)

        # Auto-promote initial admin
        if settings.INITIAL_ADMIN_WATCHA_ID and user.watcha_user_id == settings.INITIAL_ADMIN_WATCHA_ID:
            if not user.is_admin:
                user.is_admin = True
                await db.commit()
                await db.refresh(user)

        # 4. Issue our own session JWT and redirect to frontend
        session_token = create_session_token(user.id)
        response = RedirectResponse(url=settings.FRONTEND_URL, status_code=302)
        response.set_cookie(key="session", value=session_token, max_age=_COOKIE_MAX_AGE, **_COOKIE_KWARGS)
        return response

    except httpx.TimeoutException as e:
        logger.error("观猹 OAuth 请求超时: %s", e)
        return _error_redirect("连接观猹服务超时，请重试")
    except Exception as e:
        logger.error("观猹 OAuth 登录异常: %s", e, exc_info=True)
        return _error_redirect("登录过程出错，请重试")


@router.get("/me")
async def get_me(user: User = Depends(get_current_user)):
    """Return current authenticated user."""
    return {
        "id": str(user.id),
        "nickname": user.nickname,
        "avatar_url": user.avatar_url,
        "email": user.email,
        "phone": user.phone,
        "is_admin": user.is_admin,
    }


@router.post("/logout")
async def logout(response: Response, session: str | None = Cookie(default=None)):
    """Blacklist current JWT and clear session cookie."""
    if session:
        # Blacklist the token so it cannot be reused
        await blacklist_token(session)

        # Invalidate user cache (L1 + L2)
        try:
            payload = jwt.decode(session, settings.JWT_SECRET_KEY, algorithms=["HS256"])
            user_id_str = payload.get("sub")
            if user_id_str:
                await invalidate_user_cache(user_id_str)
        except JWTError:
            pass

    response.delete_cookie(key="session", path="/")
    return {"message": "已退出登录"}


# ── Dev-only: bypass OAuth for local testing ─────────────────────────────────
if settings.APP_ENV == "development":

    @router.get("/dev-login")
    async def dev_login(
        request: Request,
        db: AsyncSession = Depends(get_session),
    ):
        """Auto-login as first user (or create one). Only available in development."""
        result = await db.execute(select(User).limit(1))
        user = result.scalar_one_or_none()

        if user is None:
            user = User(
                watcha_user_id=99999,
                nickname="本地开发者",
                avatar_url=None,
                email="dev@localhost",
            )
            db.add(user)
            await db.flush()
            from app.models.knowledge_base import KnowledgeBase
            default_kb = KnowledgeBase(user_id=user.id, name="默认知识库", is_default=True)
            db.add(default_kb)
            await db.commit()
            await db.refresh(user)

        session_token = create_session_token(user.id)
        response = RedirectResponse(url=settings.FRONTEND_URL, status_code=302)
        response.set_cookie(key="session", value=session_token, max_age=_COOKIE_MAX_AGE, **_COOKIE_KWARGS)
        return response
