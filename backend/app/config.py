import os
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings

# Find .env.local first, then .env in project root (one level up from backend/)
_project_root = Path(__file__).resolve().parents[2]
_env_local = _project_root / ".env.local"
_env_file = _env_local if _env_local.exists() else _project_root / ".env"


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    ENVIRONMENT: str = "production"  # "development" | "production"
    APP_ENV: str = "production"  # default to production for safety

    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@db:5432/pingcha"
    REDIS_URL: str = "redis://redis:6379/0"
    MINIO_ENDPOINT: str = "minio:9000"
    MINIO_ACCESS_KEY: str = "minioadmin"
    MINIO_SECRET_KEY: str = "minioadmin"
    OPENAI_API_KEY: str = ""
    OPENAI_API_BASE: str = ""
    DASHSCOPE_API_KEY: str = ""
    SUPADATA_API_KEY: str = ""
    TRANSCRIPTAPI_API_KEY: str = ""
    TRANSCRIPTHQ_API_KEY: str = ""
    CELERY_BROKER_URL: str = "redis://redis:6379/1"
    SUMMARY_MODEL: str = "openai/glm-4.7"
    FAST_SUMMARY_MODEL: str = "openai/glm-4.7"   # fast pipeline: express + highlight + full
    DEEP_SUMMARY_MODEL: str = "openai/glm-5.1"   # deep pipeline: detailed (background)
    SUMMARY_API_BASE: str = ""
    YOUTUBE_COOKIES_PATH: str = "/app/cookies/cookies.txt"
    EMBEDDING_MODEL: str = "openai/text-embedding-v3"
    # Whisper ASR endpoint（语音识别，与 LLM 摘要网关分离）
    WHISPER_API_BASE: str = ""
    WHISPER_API_KEY: str = ""
    # When empty, falls back to SUMMARY_API_BASE / OPENAI_API_KEY respectively
    EMBEDDING_API_BASE: str = ""
    EMBEDDING_API_KEY: str = ""

    # Wiki KB settings
    TIKHUB_API_KEY: str = ""
    TIKHUB_API_BASE: str = "https://api.tikhub.io"
    WIKI_ARTICLE_LIMIT: int = 20
    WIKI_COMPILER_MODEL: str = "openai/glm-5.1"
    # Phase 0 single-user bypass: fixed user UUID used when no auth
    ADMIN_USER_ID: str = "00000000-0000-0000-0000-000000000001"
    ADMIN_TOKEN: str = ""

    # 讯飞语音识别（录音文件转写大模型）
    XFYUN_APP_ID: str = ""
    XFYUN_ACCESS_KEY_ID: str = ""
    XFYUN_API_SECRET: str = ""

    # 火山引擎 ASR（录音文件识别大模型-极速版）
    VOLC_ASR_APP_ID: str = ""
    VOLC_ASR_ACCESS_TOKEN: str = ""

    # RapidAPI YouTube 音频下载（yt-dlp 被封时的付费兜底）
    RAPIDAPI_KEY: str = ""

    # 观猹 OAuth2
    WATCHA_CLIENT_ID: str = ""
    WATCHA_CLIENT_SECRET: str = ""
    WATCHA_REDIRECT_URI: str = "http://localhost:8000/api/v1/auth/callback"
    WATCHA_PROXY_URL: str = ""  # e.g. "http://host:port" if server can't reach watcha.cn directly

    # JWT 密钥（生产环境必须使用至少 32 字符的随机字符串）
    # 生成方式: python -c "import secrets; print(secrets.token_urlsafe(32))"
    JWT_SECRET_KEY: str = Field(..., min_length=32)

    # Initial admin: watcha_user_id that auto-promotes to admin on first login
    INITIAL_ADMIN_WATCHA_ID: int | None = None

    # Frontend base URL (used for post-login redirect and CORS)
    FRONTEND_URL: str = "http://localhost:3000"

    # Curate module
    RESEND_API_KEY: str = ""
    PRODUCT_HUNT_API_KEY: str = ""

    class Config:
        env_file = str(_env_file) if _env_file.exists() else None
        env_file_encoding = "utf-8"
        extra = "ignore"


settings = Settings()

# Patch: ensure env vars are loaded even if pydantic-settings missed them
# (workaround for Zeabur container env injection timing)
for field_name in Settings.model_fields:
    env_val = os.environ.get(field_name)
    if env_val and not getattr(settings, field_name, None):
        object.__setattr__(settings, field_name, env_val)

# Zeabur readonly variable fallbacks (service linking injects these names)
_zeabur_fallbacks = {
    "REDIS_URL": os.environ.get("REDIS_URI") or os.environ.get("REDIS_CONNECTION_STRING"),
    "DATABASE_URL": os.environ.get("POSTGRES_URI") or os.environ.get("POSTGRES_CONNECTION_STRING"),
    "CELERY_BROKER_URL": None,  # handled in celery_app.py
}
for field_name, fallback_val in _zeabur_fallbacks.items():
    if fallback_val and field_name in Settings.model_fields:
        current = getattr(settings, field_name, "")
        # Only override if current value is the default (contains docker-compose hostnames)
        if not current or "redis:6379" in current or "@db:" in current:
            if field_name == "DATABASE_URL" and "asyncpg" not in fallback_val:
                fallback_val = fallback_val.replace("postgresql://", "postgresql+asyncpg://")
            object.__setattr__(settings, field_name, fallback_val)
