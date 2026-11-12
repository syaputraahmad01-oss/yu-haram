# YUHA Architecture

## Active YUHA runtime

The package scripts select Next.js App Router (in `src/app`) as the active YUHA app/API server:

- `next dev`
- `next build`
- `next start`

`src/app/api/` contains the route handlers: `chat`, `orchestrate`, `providers`, `github`, `deploy`, `research`, and `health` (plus the root `api/route.ts` hello handler). Pages live in `src/app` (`/`, `/workspace`, `/settings`, `/ship`). The rest of `src/` is the active application source, not a legacy tree:

- `src/components/` — UI components (chat, editor, preview, settings, ship, layout, ui)
- `src/hooks/` — React hooks (`useAIChat`, `useWebContainer`, `useFiles`, `useModelCatalog`, …)
- `src/lib/` — application libraries: `ai/`, `constants/`, `deploy/`, `foundations/`, `research/`, `runtime/`, `security/`, `store/` (Zustand), `utils/`, `webcontainer/`, `workspace/`, and `db.ts` (Prisma client)
- `src/types/` — shared TypeScript types

The old Vite + Express tree (`legacy/`) was removed from the repository in the 2026-11-12 cleanup after a grep proved nothing imports it. Do not launch any other server alongside Next.js for the same routes.

## Data layer

The application database is Supabase PostgreSQL accessed through Prisma 6 (`prisma/schema.prisma`, `src/lib/db.ts`). The retired SQLite file (`db/custom.db`, 0 records) is no longer tracked in git; `scripts/backup-sqlite.ts` and `scripts/migrate-sqlite-to-postgres.ts` remain as one-shot migration tooling that reads it from disk.

## Browser project runtime

WebContainer is a separate runtime for user-generated projects. `src/lib/webcontainer/templates.ts` contains Vite-based starter files. Vite dependencies and Vite template configuration must not be removed merely because YUHA itself runs on Next.js.

## AI workflow evidence

- `src/app/api/orchestrate` implements route-level Planner/Coder/Reviewer work.
- `src/hooks/useAIChat.ts` invokes `/api/orchestrate` for multi-model modes.
- `src/hooks/useAIChat.ts` also contains a bounded build-repair loop that sends follow-up requests to `/api/chat`.
- This confirms code call sites, not successful live provider behavior or reliable model quality.

## Package management

Bun is the single canonical package manager: all documented commands use `bun run …`, and `bun.lock` is the canonical lockfile. There is no `package-lock.json`; do not introduce a second package manager.
