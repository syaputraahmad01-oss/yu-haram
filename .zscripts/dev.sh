#!/bin/bash

set -euo pipefail

# 获取脚本所在目录（.zscripts）
# 使用 $0 获取脚本路径（与 build.sh 保持一致）
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

log_step_start() {
        local step_name="$1"
        echo "=========================================="
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting: $step_name"
        echo "=========================================="
        export STEP_START_TIME
        STEP_START_TIME=$(date +%s)
}

log_step_end() {
        local step_name="${1:-Unknown step}"
        local end_time
        end_time=$(date +%s)
        local duration=$((end_time - STEP_START_TIME))
        echo "=========================================="
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Completed: $step_name"
        echo "[LOG] Step: $step_name | Duration: ${duration}s"
        echo "=========================================="
        echo ""
}

start_mini_services() {
        local mini_services_dir="$PROJECT_DIR/mini-services"
        local started_count=0

        log_step_start "Starting mini-services"
        if [ ! -d "$mini_services_dir" ]; then
                echo "Mini-services directory not found, skipping..."
                log_step_end "Starting mini-services"
                return 0
        fi

        echo "Found mini-services directory, scanning for sub-services..."

        for service_dir in "$mini_services_dir"/*; do
                if [ ! -d "$service_dir" ]; then
                        continue
                fi

                local service_name
                service_name=$(basename "$service_dir")
                echo "Checking service: $service_name"

                if [ ! -f "$service_dir/package.json" ]; then
                        echo "[$service_name] No package.json found, skipping..."
                        continue
                fi

                if ! grep -q '"dev"' "$service_dir/package.json"; then
                        echo "[$service_name] No dev script found, skipping..."
                        continue
                fi

                echo "Starting $service_name in background..."
                (
                        cd "$service_dir"
                        echo "[$service_name] Installing dependencies..."
                        bun install
                        echo "[$service_name] Running bun run dev..."
                        exec bun run dev
                ) >"$PROJECT_DIR/.zscripts/mini-service-${service_name}.log" 2>&1 &

                local service_pid=$!
                echo "[$service_name] Started in background (PID: $service_pid)"
                echo "[$service_name] Log: $PROJECT_DIR/.zscripts/mini-service-${service_name}.log"
                disown "$service_pid" 2>/dev/null || true
                started_count=$((started_count + 1))
        done

        echo "Mini-services startup completed. Started $started_count service(s)."
        log_step_end "Starting mini-services"
}

wait_for_service() {
        local host="$1"
        local port="$2"
        local service_name="$3"
        local max_attempts="${4:-60}"
        local attempt=1

        echo "Waiting for $service_name to be ready on $host:$port..."

        while [ "$attempt" -le "$max_attempts" ]; do
                if curl -s --connect-timeout 2 --max-time 5 "http://$host:$port" >/dev/null 2>&1; then
                        echo "$service_name is ready!"
                        return 0
                fi

                echo "Attempt $attempt/$max_attempts: $service_name not ready yet, waiting..."
                sleep 1
                attempt=$((attempt + 1))
        done

        echo "ERROR: $service_name failed to start within $max_attempts seconds"
        return 1
}

cleanup() {
        if [ -n "${DEV_PID:-}" ] && kill -0 "$DEV_PID" >/dev/null 2>&1; then
                echo "Stopping Next.js dev server (PID: $DEV_PID)..."
                kill "$DEV_PID" >/dev/null 2>&1 || true
        fi
}

trap cleanup EXIT INT TERM

cd "$PROJECT_DIR"

# ── Supabase environment integrity (2026-11-12 live-migration findings) ──────
# Two platform-level hazards discovered while wiring live credentials:
#
# 1. The sandbox boot (/start.sh, platform-owned) may RESET .env to the
#    legacy `DATABASE_URL=file:...custom.db` line. .env.supabase is the
#    git-ignored backup of the real configuration — restore it when the
#    live .env no longer points at the Supabase pooler.
# 2. The tool/boot environment injects a stale `DATABASE_URL=file:...`
#    variable, and neither Next.js (@next/env) nor Bun let .env override
#    existing process env — the dev server would forever see the SQLite URL.
#    Sourcing .env with `set -a` makes the project file authoritative for
#    this process tree.
if [ -f "$PROJECT_DIR/.env.supabase" ] && ! grep -q 'pooler.supabase.com' "$PROJECT_DIR/.env" 2>/dev/null; then
        cp "$PROJECT_DIR/.env.supabase" "$PROJECT_DIR/.env"
        echo "[ENV] .env restored from .env.supabase (platform boot had reset it to the legacy SQLite URL)"
fi
if [ -f "$PROJECT_DIR/.env" ]; then
        set -a
        # shellcheck disable=SC1091
        source "$PROJECT_DIR/.env" || true
        set +a
        echo "[ENV] project .env sourced (overrides any stale inherited DATABASE_URL)"
fi

if ! command -v bun >/dev/null 2>&1; then
        echo "ERROR: bun is not installed or not in PATH"
        exit 1
fi

log_step_start "bun install"
echo "[BUN] Installing dependencies..."
bun install
log_step_end "bun install"

log_step_start "bun run db:deploy"
echo "[BUN] Applying database migrations..."
# 2026-11-12 (Supabase migration): the app database is PostgreSQL, managed by
# Prisma migrations. `migrate deploy` (NOT `db push`) is the correct boot-time
# sync: on a fresh project it applies 0001_init WITH migration history, on an
# up-to-date one it is a no-op, and it can never create the drift that a
# history-less `db push` would cause for a later `migrate deploy`.
# Environments without database credentials (e.g. this preview sandbox) boot
# fine — the app's API surface does not depend on the database — so the step
# is skipped honestly instead of killing the whole dev-server boot.
case "${DATABASE_URL:-}" in
        postgresql://*|postgres://*)
                if [[ "$DATABASE_URL" == *"<PASSWORD>"* ]]; then
                        echo "[BUN] SKIP db:deploy — DATABASE_URL still contains the <PASSWORD> placeholder (no real credentials here)"
                elif bun run db:deploy; then
                        echo "[BUN] Database migrations applied / already up to date."
                else
                        # Non-fatal on purpose: an unreachable database or a
                        # rejected password must not take the dev server down
                        # (it took the preview down once before, see
                        # CHANGELOG_REPAIR.md 2026-11-12). The failure is visible above.
                        echo "[BUN] WARN: db:deploy failed (database unreachable or credentials rejected?) — continuing without migrations"
                fi
                ;;
        *)
                echo "[BUN] SKIP db:deploy — DATABASE_URL is not a PostgreSQL URL (Supabase credentials not configured here)"
                ;;
esac
log_step_end "bun run db:deploy"

log_step_start "Starting Next.js dev server"
echo "[BUN] Starting development server..."
bun run dev &
DEV_PID=$!
log_step_end "Starting Next.js dev server"

log_step_start "Waiting for Next.js dev server"
wait_for_service "localhost" "3000" "Next.js dev server"
log_step_end "Waiting for Next.js dev server"

log_step_start "Health check"
echo "[BUN] Performing health check..."
curl -fsS localhost:3000 >/dev/null
echo "[BUN] Health check passed"
log_step_end "Health check"

start_mini_services

echo "Next.js dev server is running in background (PID: $DEV_PID)."
echo "Use 'kill $DEV_PID' to stop it."
disown "$DEV_PID" 2>/dev/null || true
unset DEV_PID
