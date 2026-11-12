/**
 * Live schema verification against Supabase PostgreSQL (runtime path:
 * DATABASE_URL / transaction pooler). Prints the actual objects found in the
 * `public` schema and validates them against the expected migration output.
 *
 * Run: set -a; source .env; set +a; bun scripts/verify-supabase-schema.ts
 */
import { PrismaClient } from '@prisma/client'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value || value.includes('<PASSWORD>')) {
    console.error(`REFUSING to run: ${name} is not configured.`)
    process.exit(1)
  }
  if (!value.startsWith('postgresql://') && !value.startsWith('postgres://')) {
    console.error(`REFUSING to run: ${name} is not a PostgreSQL URL (got protocol "${value.split(':')[0]}:") — source the project .env first.`)
    process.exit(1)
  }
  return value
}

requireEnv('DATABASE_URL')

const EXPECTED_TABLES = [
  'User', 'Session', 'Project', 'ProjectFile', 'Conversation', 'Message',
  'AiUsage', 'ModelConfig', 'UserSettings', 'AgentMemory', 'RateLimitWindow',
  'Post', '_prisma_migrations',
]
const EXPECTED_ENUMS = ['MessageRole', 'MemoryKind']

const prisma = new PrismaClient({ log: ['error'] })

async function main() {
  const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name`
  const enums = await prisma.$queryRaw<Array<{ typname: string }>>`
    SELECT t.typname FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typtype = 'e'
    ORDER BY t.typname`
  const migrations = await prisma.$queryRaw<Array<{ migration_name: string; finished_at: Date | null }>>`
    SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY migration_name`
  const fks = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count FROM information_schema.table_constraints
    WHERE constraint_type = 'FOREIGN KEY' AND table_schema = 'public'`
  const indexes = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count FROM pg_indexes WHERE schemaname = 'public'`

  const foundTables = tables.map(r => r.table_name)
  const foundEnums = enums.map(r => r.typname)

  console.log('\n=== LIVE SUPABASE SCHEMA VERIFICATION (public schema) ===\n')
  console.log('TABLES:')
  let tablesOk = true
  for (const t of EXPECTED_TABLES) {
    const present = foundTables.includes(t)
    if (!present) tablesOk = false
    console.log(`  ${present ? '✓' : '✗ MISSING'} ${t}`)
  }
  const unexpected = foundTables.filter(t => !EXPECTED_TABLES.includes(t))
  if (unexpected.length) console.log(`  (unexpected extra: ${unexpected.join(', ')})`)

  console.log('\nENUMS:')
  let enumsOk = true
  for (const e of EXPECTED_ENUMS) {
    const present = foundEnums.includes(e)
    if (!present) enumsOk = false
    console.log(`  ${present ? '✓' : '✗ MISSING'} ${e}`)
  }

  console.log('\nMIGRATION HISTORY:')
  for (const m of migrations) {
    console.log(`  ${m.finished_at ? '✓ applied' : '✗ PENDING'} ${m.migration_name}`)
  }
  const migrationsOk = migrations.length === 1 && migrations[0].migration_name === '0001_init' && migrations[0].finished_at !== null

  console.log(`\nForeign keys: ${fks[0].count} · Indexes: ${indexes[0].count}`)
  const ok = tablesOk && enumsOk && migrationsOk
  console.log(`\nRESULT: ${ok ? 'SCHEMA VERIFIED — all expected objects present' : 'SCHEMA MISMATCH — see ✗ items above'}`)
  process.exitCode = ok ? 0 : 1
}

main().finally(() => prisma.$disconnect().catch(() => {}))
