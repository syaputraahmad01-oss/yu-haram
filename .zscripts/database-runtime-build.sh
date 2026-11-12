#!/bin/bash

set -euo pipefail

# 2026-11-12 (Supabase migration): the production database is Supabase
# PostgreSQL. This script no longer packages or initializes a SQLite file.
#
# Responsibilities now:
#  1. Fail the BUILD early (with instructions) when DATABASE_URL is not a
#     PostgreSQL URL — packaging a database-less runtime would only move the
#     failure to boot time.
#  2. Copy prisma/ (schema + verified migrations) into the build so operators
#     can run `prisma migrate deploy` from the package with a full toolchain.
#  3. Optionally run `bun run db:deploy` (prisma migrate deploy) when the
#     operator explicitly sets YUHA_RUN_MIGRATIONS_ON_BUILD=1. Default is OFF:
#     production migrations are a controlled deployment step, never a silent
#     side effect of building (see directive Phase 14).

PROJECT_DIR="${PROJECT_DIR:-/home/z/my-project}"
BUILD_DIR="${BUILD_DIR:?BUILD_DIR is required}"

echo "🗄️  Validating database configuration (Supabase PostgreSQL)..."

case "${DATABASE_URL:-}" in
    postgresql://*|postgres://*)
        echo "🗄️  DATABASE_URL: PostgreSQL connection configured"
        ;;
    *)
        echo "❌ DATABASE_URL is missing or not a PostgreSQL URL."
        echo "   The production database is Supabase PostgreSQL (see .env.example)."
        echo "   Set DATABASE_URL (transaction pooler) and DIRECT_URL (session pooler)"
        echo "   in the build environment, then build again."
        exit 1
        ;;
esac

if [ ! -f "$PROJECT_DIR/prisma/schema.prisma" ]; then
    echo "❌ prisma/schema.prisma not found in $PROJECT_DIR"
    exit 1
fi

# Ship the schema + verified migrations with the package (tiny, self-describing).
mkdir -p "$BUILD_DIR/prisma"
cp -r "$PROJECT_DIR/prisma/." "$BUILD_DIR/prisma/"
echo "✅ prisma/ (schema + migrations) copied into the build"

if [ "${YUHA_RUN_MIGRATIONS_ON_BUILD:-0}" = "1" ]; then
    case "${DIRECT_URL:-}" in
        postgresql://*|postgres://*)
            ;;
        *)
            echo "❌ YUHA_RUN_MIGRATIONS_ON_BUILD=1 requires DIRECT_URL (session pooler) for migrations."
            exit 1
            ;;
    esac
    echo "🗄️  Running prisma migrate deploy (explicitly requested)..."
    (
        cd "$PROJECT_DIR"
        bun run db:deploy
    )
    echo "✅ Migrations deployed"
else
    echo "ℹ️  Migrations NOT run at build time (set YUHA_RUN_MIGRATIONS_ON_BUILD=1 to enable)."
    echo "   Run 'bun run db:deploy' as a controlled deployment step instead."
fi

echo "✅ Database runtime build preparation complete"
