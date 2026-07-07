# Deployment

This document describes the public, self-hosted deployment path for Pincha.

## Files

- `docker-compose.yml`: full application stack. Sensitive values must be provided through environment variables or `.env`.
- `docker-compose.dev.yml`: local development stack with safe local-only defaults.
- `docker-compose.infra.yml`: infrastructure-only local stack for running the app directly on the host.
- `.env.example`: complete public environment template.

## Required Variables

Production-like Compose runs require these values:

```env
POSTGRES_PASSWORD=replace_with_a_strong_database_password
MINIO_ACCESS_KEY=replace_with_object_storage_user
MINIO_SECRET_KEY=replace_with_object_storage_password
WHISPER_API_KEY=replace_with_your_asr_api_key
OPENAI_API_KEY=replace_with_your_llm_api_key
```

`WHISPER_API_KEY` enables optional speech-to-text when paired with `WHISPER_API_BASE`. If submitted videos already include usable captions, ASR can stay disabled.

Pincha Community Edition runs in single-user local mode. It has no login, registration, external identity callback, browser session token, or multi-user identity service. The backend automatically creates one Local Owner and all content belongs to that local instance.

## Full Stack

```bash
cp .env.example .env
docker compose up --build
```

The public ports are:

- `3000`: frontend
- `8000`: backend API
- `80`: nginx, configurable with `HTTP_PORT`

## Local Infrastructure Only

Use this when running backend and frontend directly on your machine:

```bash
docker compose -f docker-compose.infra.yml up -d
```

Local ports are bound to `127.0.0.1`.

## Security Notes

- Never commit `.env`.
- Do not reuse example values in production.
- Replace database and object storage secrets for every environment.
- Keep CI/CD tokens in your deployment platform secret store.
- Do not expose MinIO, PostgreSQL, or Redis directly to the public internet.
- Do not expose an unauthenticated Pincha instance directly to the public internet.
