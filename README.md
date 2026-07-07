# Pincha

Pincha is an open-source app for collecting, transcribing, summarizing, and organizing long-form video and audio content. It provides a web UI, a FastAPI backend, background workers, PostgreSQL with pgvector, Redis, and optional object storage.

## What It Does

- Submit video or audio URLs for processing.
- Extract captions or transcribe audio.
- Generate summaries, highlights, mind maps, and searchable knowledge entries.
- Browse processed content from a local web interface.
- Run locally with Docker Compose.

## What It Does Not Do

- It does not ship with production credentials.
- It does not include hosted Pincha operations, admin jobs, or private deployment workflows.
- It does not provide legal access around platform restrictions; configure providers, cookies, or proxies only where you are allowed to do so.

## Quick Start

Requirements:

- Docker and Docker Compose
- A Typeless API key for speech-to-text
- An OpenAI-compatible LLM API key for summary generation

```bash
cp .env.example .env
```

Edit `.env`:

```env
JWT_SECRET_KEY=replace_with_a_long_random_secret_at_least_32_chars
POSTGRES_PASSWORD=change_me_to_a_real_password
MINIO_ACCESS_KEY=replace_me
MINIO_SECRET_KEY=replace_me
TYPELESS_API_KEY=replace_with_your_typeless_api_key
OPENAI_API_KEY=replace_with_your_llm_api_key
```

Start the full stack:

```bash
docker compose up --build
```

Open:

- Frontend: http://localhost:3000
- Backend health: http://localhost:8000/health

For infrastructure-only local development:

```bash
docker compose -f docker-compose.infra.yml up -d
```

## Typeless Setup

Pincha is designed to work with Typeless for audio transcription:

1. Create a Typeless API key.
2. Put it in `.env` as `TYPELESS_API_KEY`.
3. Keep `TYPELESS_MODEL=whisper-1`, or change it if your Typeless account uses a different model name.
4. Submit a video or audio URL from the web UI.

Advanced users can override `TYPELESS_API_BASE`. If `TYPELESS_API_KEY` is not set, Pincha can fall back to an OpenAI-compatible speech-to-text endpoint through `WHISPER_API_BASE` and `WHISPER_API_KEY`.

## Documentation

- [Deployment](docs/deployment.md)
- [Environment variables](.env.example)
- [Frontend routes](docs/frontend-routes.md)
- [Design system](docs/design-system.md)
- [Contributing](CONTRIBUTING.md)

## High-Level Architecture

Pincha has four main parts:

- `frontend/`: Next.js web application.
- `backend/`: FastAPI API service and processing logic.
- Background workers: asynchronous processing for extraction, transcription, summaries, and indexing.
- Infrastructure: PostgreSQL + pgvector, Redis, and optional S3-compatible object storage.

Implementation details that are only relevant to hosted operations are intentionally not documented in this public repository.

## Development

Backend:

```bash
cd backend
pip install -r requirements.txt
pytest
```

Frontend:

```bash
cd frontend
npm ci
npm run lint
npm run build
```

## Contributing

Issues and pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR.

Do not include tokens, private logs, account identifiers, production hostnames, or credentials in issues or pull requests.

## Security

Please do not open public issues for security vulnerabilities. Report security concerns through the repository security advisory flow or contact the maintainers privately.

If you accidentally committed a secret, rotate it immediately. Removing a secret from a later commit does not remove it from Git history.

## License

This project is licensed under the terms in [LICENSE](LICENSE).
