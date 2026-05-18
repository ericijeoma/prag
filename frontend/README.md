# PRAG RAG Frontend (Presentation Layer)

Decoupled React UI for the production RAG system.

## Requirements

- **pnpm only** (workspace-managed)
- Backend endpoint: `https://prag.ericijeoma7767.workers.dev/chat`

## Run locally

From repo root:

```bash
pnpm -C frontend install
pnpm -C frontend dev
```

Then open:

- http://127.0.0.1:5173/

## Build

```bash
pnpm -C frontend build
pnpm -C frontend preview
```

## Contract alignment / behavior

- Persists `session_id` in `localStorage` (keeps continuity with backend chat persistence).
- Sidebar shows recent turns and can clear history (clears local history + resets `session_id`).
- Renders answer markdown.
- Parses inline footnotes like `【Source: <chunk_id>】` and maps them to citation badges + tooltip metadata (title + similarity).
- Status banners map to backend `AnswerResult`:
  - `verified: true` → green “Context Authenticated”
  - `verified: false` → amber “Unverified Response Baseline”
  - `degraded: true` or safe fallback “no evidence” answer → explicit no-evidence alert

## Observability (Sentry)

`@sentry/react` is installed and the app is wrapped in a Sentry Error Boundary.

Every `/chat` fetch:

- tags telemetry with `session_id`
- attaches `traceId` from the backend response (when present)

This links frontend errors/perf to backend traces/Supabase logs.
