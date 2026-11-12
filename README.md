# YUHA

YUHA is a browser-based AI development workspace with a Next.js application/API runtime and WebContainer-based project execution in the browser.

## Engineering commands (Pass 13)

```bash
bun install            # satu package manager utama: Bun
bun run dev            # dev server (port 3000)
bun run type-check     # tsc --noEmit — production build juga menjalankan ini (ignoreBuildErrors dihapus)
bun run lint           # eslint .
bun run test           # bun x tsx --test tests/*.test.ts
bun run verify         # type-check + lint + test
bun run build          # next build (standalone) + salin static/public
bun run start          # bun .next/standalone/server.js
```

Keamanan default (Pass 13): rate limiting + SSRF/DNS-rebinding guard pada semua API routes, CSP/COOP/COEP, API key pengguna disimpan terenkripsi AES-256-GCM di browser. Aset internal tidak lagi berada di `public/`.

## Requirements

- Node.js 20.9 or newer (required by the configured Next.js line)
- Bun 1.3.x — the single package manager; `bun.lock` is the canonical lockfile
- A modern browser with WebAssembly and SharedArrayBuffer support for WebContainers

## Install and run

```bash
bun install
bun run dev
```

Open `http://localhost:3000`.

## Verify

```bash
bun run type-check
bun run test
bun run build
```

A successful static check or unit-test run does not prove that provider credentials work, that WebContainers boot in a target browser, or that a deployment provider accepts a deployment. Those require separate integration tests with valid user credentials and the target environment.

## AI provider keys

Configure provider keys in YUHA Settings. Keys are sent to the server for the relevant request; do not commit real credentials. The `.env.example` file is documentation only and is not a source of provider credentials for the browser workflow.

## Database (Supabase PostgreSQL)

The application database is **Supabase PostgreSQL** accessed through **Prisma 6** (see `prisma/schema.prisma`). The SQLite file that used to boot with the template (`db/custom.db`, always empty — 0 records) is retired from runtime; an untouched backup lives in `db/backups/`.

Two connection URLs are required (see `.env.example` for the exact Supabase hosts):

- `DATABASE_URL` — transaction pooler (port 6543, `?pgbouncer=true`): used by the running app.
- `DIRECT_URL` — session pooler (port 5432): used by Prisma CLI for migrations (`prisma migrate dev`, `prisma db push`).

The database password is a secret: set it in `.env` (git-ignored) or the deployment environment. Never commit it, never log it, never expose it to the browser.

```bash
bun run db:generate      # regenerate the Prisma client (offline)
bun run db:push          # sync schema (development convenience)
bun run db:deploy        # prisma migrate deploy — the CONTROLLED production step
bun scripts/migrate-sqlite-to-postgres.ts   # one-shot legacy data migration (source is empty; refuses to run without credentials)
```

Operational notes:

- Migrations are **not** run at build or boot by default. Builds validate that `DATABASE_URL` is a PostgreSQL URL and ship `prisma/` with the package; `YUHA_RUN_MIGRATIONS_ON_BUILD=1` opts into running `db:deploy` during the build (requires `DIRECT_URL`).
- Production startup (`.zscripts/start.sh`) fails fast when `DATABASE_URL` is missing instead of silently booting a database-less runtime.
- The dev sandbox boots fine without credentials: `dev.sh` skips `db:push` honestly (the app's API surface does not depend on the database today).
- `GET /api/health/database` verifies the live connection end-to-end and reports latency without leaking connection details.
- Rate limiting supports a shared `postgres` backend (`YUHA_RATE_LIMIT_BACKEND=postgres`) for multi-instance deployments; the default remains per-process `memory`.

## Runtime architecture

The active app/API runtime is Next.js App Router in `src/app` (`src/app/api/` contains the chat, orchestration, provider, GitHub, deployment, research, and health route handlers). `src/` is the active application source — not a legacy tree. The old Vite + Express tree (`legacy/`) was removed from the repository in the 2026-11-12 cleanup; do not start any other server alongside Next.js for the same routes.

## Deployment safety

Deployment endpoints reject unsafe paths and sensitive credential files. `.env.example` is allowed as a template; real `.env*` files, private keys, and common credential files are blocked. Review all files before deploying.

## Repair Pass 6 notes

The Next.js `/api/chat` and `/api/orchestrate` handlers validate workspace file maps before invoking AI workflows. Validation rejects unsafe relative paths, non-string file contents, more than 500 files, files larger than 1 MB, and aggregate content larger than 15 MB. AI context construction additionally excludes common credential/deployment files and redacts several common provider token formats. These controls are defense-in-depth and do not guarantee detection of every possible secret.

Historical per-pass verification evidence lives in `REPAIR_STATUS.md` and `YUHA_TEST_REPORT.md`; those documents are the source of truth for what was and was not verified in each pass.
