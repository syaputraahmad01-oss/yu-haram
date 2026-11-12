#!/bin/bash

set -euo pipefail

# Tests for .zscripts/database-runtime-build.sh AFTER the Supabase migration
# (2026-11-12). The script no longer packages SQLite; it validates a
# PostgreSQL DATABASE_URL, copies prisma/ into the build, and only runs
# `prisma migrate deploy` when explicitly opted in.
#
# Uses a fake `bun` on PATH to observe invocations without touching any real
# database — the real migration run needs Supabase credentials and is
# executed/reported separately.

SCRIPT_DIR="$(cd "$(dirname "$0")/../.zscripts" && pwd)"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEST_ROOT"' EXIT

FAKE_BIN="$TEST_ROOT/bin"
mkdir -p "$FAKE_BIN"
cat >"$FAKE_BIN/bun" <<'EOF'
#!/bin/bash
set -euo pipefail

if [ "$#" -ne 2 ] || [ "$1" != "run" ] || [ "$2" != "db:deploy" ]; then
    echo "unexpected bun invocation: $*" >&2
    exit 1
fi
printf '%s\n' "${DATABASE_URL:-}" >>"${DB_DEPLOY_CALLS:?}"
EOF
chmod +x "$FAKE_BIN/bun"

export PATH="$FAKE_BIN:$PATH"
export DB_DEPLOY_CALLS="$TEST_ROOT/db-deploy-calls"
: >"$DB_DEPLOY_CALLS"

# A project with a real prisma directory (schema + migration).
make_project() {
    local dir="$1"
    mkdir -p "$dir/prisma/migrations/0001_init"
    printf 'datasource db {\n  provider = "postgresql"\n}\n' >"$dir/prisma/schema.prisma"
    printf 'CREATE TABLE "User";\n' >"$dir/prisma/migrations/0001_init/migration.sql"
    printf 'provider = "postgresql"\n' >"$dir/prisma/migrations/migration_lock.toml"
}

# ── Case 1: no DATABASE_URL → build must FAIL with guidance, no bun call. ──
PROJECT_A="$TEST_ROOT/project-a"
BUILD_A="$TEST_ROOT/build-a"
make_project "$PROJECT_A"

if PROJECT_DIR="$PROJECT_A" BUILD_DIR="$BUILD_A" \
    bash "$SCRIPT_DIR/database-runtime-build.sh" >"$TEST_ROOT/a.log" 2>&1; then
    echo "FAIL: build succeeded without DATABASE_URL"
    exit 1
fi
grep -q "DATABASE_URL" "$TEST_ROOT/a.log"
test "$(wc -l <"$DB_DEPLOY_CALLS" | tr -d ' ')" = "0"
echo "case 1 ok: missing DATABASE_URL fails the build honestly"

# ── Case 2: PostgreSQL DATABASE_URL, no opt-in → success, prisma/ copied,
#            NO migrations executed, NO sqlite artifacts. ────────────────────
: >"$DB_DEPLOY_CALLS"
PROJECT_B="$TEST_ROOT/project-b"
BUILD_B="$TEST_ROOT/build-b"
make_project "$PROJECT_B"

PROJECT_DIR="$PROJECT_B" BUILD_DIR="$BUILD_B" DATABASE_URL="postgresql://user:pw@example.host:6543/postgres?pgbouncer=true" \
    bash "$SCRIPT_DIR/database-runtime-build.sh" >"$TEST_ROOT/b.log" 2>&1

test -f "$BUILD_B/prisma/schema.prisma"
test -f "$BUILD_B/prisma/migrations/0001_init/migration.sql"
test -f "$BUILD_B/prisma/migrations/migration_lock.toml"
test ! -e "$BUILD_B/db/custom.db"
test "$(wc -l <"$DB_DEPLOY_CALLS" | tr -d ' ')" = "0"
grep -q "NOT run at build time" "$TEST_ROOT/b.log"
echo "case 2 ok: prisma/ shipped, no silent migrations, no sqlite packaging"

# ── Case 3: opt-in without DIRECT_URL → must FAIL (migrations need it). ────
: >"$DB_DEPLOY_CALLS"
PROJECT_C="$TEST_ROOT/project-c"
BUILD_C="$TEST_ROOT/build-c"
make_project "$PROJECT_C"

if PROJECT_DIR="$PROJECT_C" BUILD_DIR="$BUILD_C" \
    DATABASE_URL="postgresql://user:pw@example.host:6543/postgres" \
    YUHA_RUN_MIGRATIONS_ON_BUILD=1 \
    bash "$SCRIPT_DIR/database-runtime-build.sh" >"$TEST_ROOT/c.log" 2>&1; then
    echo "FAIL: opt-in migrations ran without DIRECT_URL"
    exit 1
fi
grep -q "DIRECT_URL" "$TEST_ROOT/c.log"
test "$(wc -l <"$DB_DEPLOY_CALLS" | tr -d ' ')" = "0"
echo "case 3 ok: opt-in requires DIRECT_URL"

# ── Case 4: opt-in with both URLs → bun run db:deploy called exactly once. ──
: >"$DB_DEPLOY_CALLS"
PROJECT_D="$TEST_ROOT/project-d"
BUILD_D="$TEST_ROOT/build-d"
make_project "$PROJECT_D"

PROJECT_DIR="$PROJECT_D" BUILD_DIR="$BUILD_D" \
    DATABASE_URL="postgresql://user:pw@example.host:6543/postgres?pgbouncer=true" \
    DIRECT_URL="postgresql://user:pw@example.host:5432/postgres" \
    YUHA_RUN_MIGRATIONS_ON_BUILD=1 \
    bash "$SCRIPT_DIR/database-runtime-build.sh" >"$TEST_ROOT/d.log" 2>&1

test "$(wc -l <"$DB_DEPLOY_CALLS" | tr -d ' ')" = "1"
grep -Fxq "postgresql://user:pw@example.host:6543/postgres?pgbouncer=true" "$DB_DEPLOY_CALLS"
echo "case 4 ok: explicit opt-in runs prisma migrate deploy once"

echo "database runtime build tests passed"
