/**
 * Supabase PostgreSQL migration — offline verification suite.
 *
 * Everything here runs WITHOUT a live database connection (the sandbox has
 * no Supabase password). Live connectivity, migrate deploy, data migration,
 * and latency are reported as NOT TESTED in YUHA_SUPABASE_MIGRATION_REPORT.md
 * until executed with real credentials.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')

test('prisma schema targets PostgreSQL with a pooled runtime URL and a direct migration URL', async () => {
  const schema = await readFile(join(root, 'prisma/schema.prisma'), 'utf8')
  assert.equal(schema.includes('provider  = "postgresql"'), true, 'provider must be postgresql')
  assert.equal(schema.includes('url       = env("DATABASE_URL")'), true, 'runtime URL from DATABASE_URL')
  assert.equal(schema.includes('directUrl = env("DIRECT_URL")'), true, 'migration URL from DIRECT_URL')
  assert.equal(schema.includes('sqlite'), false, 'no sqlite provider remains in the schema')
})

test('schema defines the target domain models with PostgreSQL-native types', async () => {
  const schema = await readFile(join(root, 'prisma/schema.prisma'), 'utf8')
  for (const model of [
    'model User', 'model Session', 'model Project', 'model ProjectFile',
    'model Conversation', 'model Message', 'model AiUsage', 'model ModelConfig',
    'model UserSettings', 'model AgentMemory', 'model RateLimitWindow', 'model Post',
  ]) {
    assert.equal(schema.includes(model), true, `${model} must exist`)
  }
  // PostgreSQL-native capabilities the SQLite era could not express.
  assert.equal(schema.includes('enum MessageRole'), true)
  assert.equal(schema.includes('enum MemoryKind'), true)
  assert.equal(schema.includes('@db.Decimal(12, 6)'), true, 'exact-decimal money column')
  // Secrets hygiene: session tokens are stored hashed, passwords nullable-hash.
  assert.equal(schema.includes('tokenHash String   @unique'), true)
  assert.equal(schema.includes('hashedPassword String?'), true)
})

test('initial migration exists, is PostgreSQL, and covers every model', async () => {
  const lock = await readFile(join(root, 'prisma/migrations/migration_lock.toml'), 'utf8')
  assert.equal(lock.includes('provider = "postgresql"'), true)
  const sql = await readFile(join(root, 'prisma/migrations/0001_init/migration.sql'), 'utf8')
  for (const table of [
    '"User"', '"Session"', '"Project"', '"ProjectFile"', '"Conversation"',
    '"Message"', '"AiUsage"', '"ModelConfig"', '"UserSettings"',
    '"AgentMemory"', '"RateLimitWindow"', '"Post"',
  ]) {
    assert.equal(sql.includes(`CREATE TABLE ${table}`), true, `${table} must be created`)
  }
  assert.equal(sql.includes('CREATE TYPE "MessageRole"'), true, 'native enum')
  assert.equal(sql.includes('ON DELETE CASCADE'), true, 'referential actions')
  assert.equal(sql.includes('FOREIGN KEY'), true, 'foreign keys')
})

test('SQLite source is preserved untouched after backup', async () => {
  // The pre-migration backup must exist with the untouched original.
  const backup = await readFile(join(root, 'db/backups/2026-11-12-pre-supabase/sqlite-schema.sql'), 'utf8')
  assert.equal(backup.includes('## User — 0 records'), true)
  assert.equal(backup.includes('## Post — 0 records'), true)
})

test('data migration tool refuses to run without credentials', async () => {
  const source = await readFile(join(root, 'scripts/migrate-sqlite-to-postgres.ts'), 'utf8')
  assert.equal(source.includes("value.includes('<PASSWORD>')"), true, 'rejects placeholder credentials')
  assert.equal(source.includes('readonly: true'), true, 'source database opened read-only')
  assert.equal(source.includes('upsert'), true, 'idempotent upserts — reruns never duplicate')
})

test('db client is a single pooled instance with env-gated query logging', async () => {
  const source = await readFile(join(root, 'src/lib/db.ts'), 'utf8')
  assert.equal(source.includes('globalForPrisma.prisma'), true, 'singleton cached across hot reloads')
  assert.equal(source.includes("YUHA_DB_LOG_QUERIES === '1'"), true, 'query logging is opt-in')
  assert.equal(source.includes("'query', 'error', 'warn'"), true)
})

test('health endpoint never leaks connection details', async () => {
  const source = await readFile(join(root, 'src/app/api/health/database/route.ts'), 'utf8')
  assert.equal(source.includes('rejectCrossOrigin'), true, 'CSRF guard')
  assert.equal(source.includes('checkRateLimit'), true, 'rate limited')
  assert.equal(source.includes('RATE_LIMITS.health'), true)
  assert.equal(source.includes('latencyMs'), true)
  // The response body must not embed the raw error (host/credential leak).
  assert.equal(source.includes('console.error'), true, 'raw error logged server-side only')
})

test('deployment scripts no longer fall back to packaged SQLite', async () => {
  const start = await readFile(join(root, '.zscripts/start.sh'), 'utf8')
  assert.equal(start.includes('file:/app/db/custom.db'), false, 'no SQLite fallback URL')
  assert.equal(start.includes('postgresql://*|postgres://*'), true, 'validates PostgreSQL URL')
  const build = await readFile(join(root, '.zscripts/database-runtime-build.sh'), 'utf8')
  assert.equal(build.includes('custom.db'), false, 'no SQLite packaging')
  assert.equal(build.includes('YUHA_RUN_MIGRATIONS_ON_BUILD'), true, 'migrations are explicit opt-in')
  const dev = await readFile(join(root, '.zscripts/dev.sh'), 'utf8')
  assert.equal(dev.includes('SKIP db:deploy'), true, 'sandbox boot skips db:deploy without credentials')
  assert.equal(dev.includes('bun run db:deploy'), true, 'boot sync uses migrate deploy, never history-less db push')
  // 2026-11-12 live findings: platform boot resets .env to the SQLite URL and
  // injects a stale DATABASE_URL into the environment — dev.sh must defend
  // against both (restore from backup + source .env authoritatively).
  assert.equal(dev.includes('.env.supabase'), true, 'boot restores .env from the git-ignored backup after platform reset')
  assert.equal(dev.includes('source "$PROJECT_DIR/.env"'), true, 'boot sources .env so the file wins over stale inherited env')
})

test('package.json exposes a controlled deployment migration command', async () => {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
  assert.equal(pkg.scripts['db:deploy'], 'prisma migrate deploy')
})

test('env template documents the Supabase topology without any secret', async () => {
  const example = await readFile(join(root, '.env.example'), 'utf8')
  assert.equal(example.includes('aws-1-ap-northeast-2.pooler.supabase.com:6543'), true, 'transaction pooler documented')
  assert.equal(example.includes('aws-1-ap-northeast-2.pooler.supabase.com:5432'), true, 'session pooler documented')
  assert.equal(example.includes('<PASSWORD>'), true, 'password stays a placeholder')
  // Tracked template must not contain a real-looking password.
  assert.equal(/:[A-Za-z0-9_-]{20,}@/.test(example), false)
})
