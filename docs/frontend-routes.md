# Frontend Routes

This document describes the public route structure and naming conventions for contributors.

## Route Groups

| Area | Purpose |
| --- | --- |
| `/` | Product entry and primary navigation |
| `/login` | User sign-in flow |
| `/videos` | Submitted video and audio processing views |
| `/videos/[id]` | Detail page for transcript, summary, citations, and mind map |
| `/articles` | Article collection and analysis views |
| `/articles/[id]` | Article detail page |
| `/library` | Saved knowledge and searchable entries |
| `/curate` | Personal content feed and subscriptions |
| `/trending` | Public discovery views |

Internal admin, debug, test, and operations routes are intentionally excluded from the public route guide.

## Directory Layout

```text
frontend/
  app/                Next.js App Router pages
  components/         Reusable UI and feature components
  hooks/              Data fetching and interaction hooks
  lib/api/            Typed API client modules
  types/              Shared TypeScript types
  tests/              Unit and end-to-end tests
```

## Naming Rules

- Use route folders that match the public URL.
- Keep page components thin; put reusable logic in `hooks/` or feature components.
- Keep API calls in `lib/api/`.
- Prefer descriptive route segment names over abbreviations.
- Do not add undocumented admin or operations pages to the public app.
