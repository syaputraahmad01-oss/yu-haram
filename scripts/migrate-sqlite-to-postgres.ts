/**
 * Phase 3 — SQLite → Supabase PostgreSQL data migration.
 *
 * Contract (directive §6):
 *  - Repeatable: upserts by primary key, so re-running never duplicates.
 *  - Non-destructive: the SQLite source is opened READ-ONLY and never
 *    modified or deleted.
 *  - Validated: prints a per-table source-vs-destination count table with
 *    PASS/FAIL and exits non-zero on any mismatch.
 *  - Fails loudly (no blind retries): requires DATABASE_URL + DIRECT_URL to
 *    be configured first; connection problems abort before any write.
 *
 * Run: bun scripts/migrate-sqlite-to-postgres.ts
 * (Requires the real Supabase password in .env — status NOT TESTED until
 * executed with credentials.)
 */
import { PrismaClient } from '@prisma/client'

const SQLITE_PATH = process.argv[2] || 'db/custom.db'

/** Runtime-loaded bun:sqlite, typed structurally — the module name stays a
 * variable so tsc (no Bun types) never resolves it; under `bun` it loads. */
async function openSqlite(path: string, options?: { readonly?: boolean }): Promise<BunSqliteDb> {
  const moduleName = 'bun:sqlite'
  const mod = (await import(moduleName)) as { Database: new (path: string, options?: { readonly?: boolean }) => BunSqliteDb }
  return new mod.Database(path, options)
}

interface BunSqliteRow { [column: string]: unknown }
interface BunSqliteDb {
  query: (sql: string) => { all: () => unknown[]; get: (...args: unknown[]) => unknown }
  close: () => void
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value || value.includes('<PASSWORD>')) {
    console.error(`REFUSING to run: ${name} is not configured (set it in .env with the real Supabase password).`)
    process.exit(1)
  }
  return value
}

requireEnv('DATABASE_URL')
requireEnv('DIRECT_URL')

/** SQLite DATETIME columns may hold epoch-ms numbers or ISO strings. */
function toDate(value: unknown): Date {
  if (typeof value === 'number') return new Date(value)
  if (typeof value === 'string') {
    if (/^\d+$/.test(value)) return new Date(Number(value))
    const parsed = Date.parse(value)
    if (!Number.isNaN(parsed)) return new Date(parsed)
  }
  return new Date(0)
}

function readTable(sqlite: BunSqliteDb, table: string): BunSqliteRow[] {
  const exists = sqlite
    .query("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(table)
  if (!exists) return []
  return sqlite.query(`SELECT * FROM "${table}"`).all() as BunSqliteRow[]
}

async function main() {
  const sqlite = await openSqlite(SQLITE_PATH, { readonly: true })
  const prisma = new PrismaClient({ log: ['error'] })

  try {
    const users = readTable(sqlite, 'User')
    const posts = readTable(sqlite, 'Post')

    // Users first: Posts reference them via authorId (FK added in the PG schema).
    for (const row of users) {
      await prisma.user.upsert({
        where: { id: String(row.id) },
        create: {
          id: String(row.id),
          email: String(row.email),
          name: row.name == null ? null : String(row.name),
          hashedPassword: null, // SQLite schema had no password column.
          createdAt: toDate(row.createdAt),
          updatedAt: toDate(row.updatedAt),
        },
        update: {
          email: String(row.email),
          name: row.name == null ? null : String(row.name),
        },
      })
    }

    // Posts whose authorId does not exist in the source Users table would
    // violate the new FK; report and skip them honestly instead of failing
    // the whole run silently.
    const userIds = new Set(users.map(row => String(row.id)))
    const orphanPosts = posts.filter(row => !userIds.has(String(row.authorId)))
    for (const row of posts) {
      if (!userIds.has(String(row.authorId))) continue
      await prisma.post.upsert({
        where: { id: String(row.id) },
        create: {
          id: String(row.id),
          title: String(row.title),
          content: row.content == null ? null : String(row.content),
          published: row.published === 1 || row.published === true,
          authorId: String(row.authorId),
          createdAt: toDate(row.createdAt),
          updatedAt: toDate(row.updatedAt),
        },
        update: { title: String(row.title) },
      })
    }

    // ── Validation table (directive §6 format) ─────────────────────────────
    const [userCount, postCount] = await Promise.all([
      prisma.user.count(),
      prisma.post.count(),
    ])
    const rows: Array<[string, number, number, string]> = [
      ['User', users.length, userCount, users.length === userCount ? 'PASS' : 'FAIL'],
      ['Post', posts.length - orphanPosts.length, postCount, posts.length - orphanPosts.length === postCount ? 'PASS' : 'FAIL'],
    ]

    console.log('\nTabel        SQLite  PostgreSQL  Status')
    for (const [table, source, dest, status] of rows) {
      console.log(`${table.padEnd(12)}${String(source).padEnd(8)}${String(dest).padEnd(12)}${status}`)
    }
    if (orphanPosts.length > 0) {
      console.log(`\nWARN: ${orphanPosts.length} Post row(s) skipped — authorId has no matching User (FK would fail).`)
    }

    const failed = rows.some(row => row[3] === 'FAIL')
    if (failed) {
      console.error('\nMIGRATION VALIDATION FAILED — investigate the counts above. Source database untouched.')
      process.exitCode = 1
    } else {
      console.log('\nMIGRATION VALIDATED — counts match. Source database untouched.')
    }
  } finally {
    await prisma.$disconnect().catch(() => {})
    sqlite.close()
  }
}

void main()
