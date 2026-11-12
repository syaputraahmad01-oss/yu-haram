/**
 * Phase 13 pre-migration backup — run BEFORE any schema/provider change.
 * Copies the SQLite database file (a file copy IS a consistent SQLite backup
 * here: the dev server holds no connection to it — db.ts has zero importers)
 * and dumps the schema + per-table counts as human-readable evidence.
 */
import { cp, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Runtime-loaded bun:sqlite, typed structurally — the module name stays a
 * variable so tsc (no Bun types) never resolves it; under `bun` it loads.
 * This script is a Bun-only ops tool by design. */
async function openSqlite(path: string, options?: { readonly?: boolean }): Promise<BunSqliteDb> {
  const moduleName = 'bun:sqlite'
  const mod = (await import(moduleName)) as { Database: new (path: string, options?: { readonly?: boolean }) => BunSqliteDb }
  return new mod.Database(path, options)
}

interface BunSqliteDb {
  query: (sql: string) => { all: () => unknown[]; get: (...args: unknown[]) => unknown }
  close: () => void
}

const stamp = process.argv[2] || new Date().toISOString().replace(/[:.]/g, '-')
const dbPath = 'db/custom.db'
const backupDir = `db/backups/${stamp}`

await mkdir(backupDir, { recursive: true })
await cp(dbPath, join(backupDir, 'custom.db.bak'))

const db = await openSqlite(dbPath, { readonly: true })
const tables = db
  .query("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
  .all() as Array<{ name: string; sql: string }>

let report = `# SQLite backup evidence — ${stamp}\n# source: ${dbPath} (copied to custom.db.bak)\n\n`
for (const t of tables) {
  const count = (db.query(`SELECT COUNT(*) AS c FROM "${t.name}"`).get() as { c: number }).c
  report += `## ${t.name} — ${count} records\n${t.sql};\n\n`
}
await writeFile(join(backupDir, 'sqlite-schema.sql'), report)
await cp('prisma/schema.prisma', join(backupDir, 'schema.prisma.sqlite.bak'))
console.log(report)
console.log(`BACKUP OK → ${backupDir}/ (custom.db.bak, sqlite-schema.sql, schema.prisma.sqlite.bak)`)
