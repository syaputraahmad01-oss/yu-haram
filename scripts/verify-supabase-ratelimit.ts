/**
 * LIVE verification of the optional postgres rate-limit backend (Phase 7)
 * against the real Supabase database: atomic upsert windows shared through
 * the RateLimitWindow table.
 *
 * Steps: 12 synthetic requests under a limit-5 rule → expect exactly the first
 * 5 allowed; verify the window row exists in PostgreSQL; clean it up.
 *
 * Run: set -a; source .env; set +a; YUHA_RATE_LIMIT_BACKEND=postgres bun scripts/verify-supabase-ratelimit.ts
 */
import { checkRateLimit, rateLimitBackend } from '../src/lib/security/rate-limit'
import { db } from '../src/lib/db'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value || value.includes('<PASSWORD>')) {
    console.error(`REFUSING to run: ${name} is not configured.`)
    process.exit(1)
  }
  return value
}

requireEnv('DATABASE_URL')
if (process.env.YUHA_RATE_LIMIT_BACKEND !== 'postgres') {
  console.error('REFUSING to run: set YUHA_RATE_LIMIT_BACKEND=postgres for this verification.')
  process.exit(1)
}

const TEST_IP = '198.51.100.77' // TEST-NET-2, never a real client
const RULE = { name: 'live-verify-test', limit: 5, windowMs: 60_000 }

async function main() {
  const backend = await rateLimitBackend()
  console.log(`\n=== LIVE RATE-LIMIT POSTGRES BACKEND VERIFICATION ===\n`)
  console.log(`active backend: ${backend}`)
  if (backend !== 'postgres') {
    console.error('FAIL: backend did not resolve to postgres')
    process.exitCode = 1
    return
  }

  // Clean slate for the test key (idempotent reruns).
  await db.$executeRaw`DELETE FROM "RateLimitWindow" WHERE "key" LIKE ${`${RULE.name}:%`}`

  const results: boolean[] = []
  for (let i = 1; i <= 12; i++) {
    // Identity is injected through the TRUSTED path (x-forwarded-for with
    // hops=1); since the 2026-11 security fix, x-real-ip is ignored at
    // hops=0, so it can no longer be used to pin a synthetic identity.
    const request = new Request('http://localhost/api/health/database', {
      headers: { 'x-forwarded-for': TEST_IP },
    })
    const result = await checkRateLimit(request, RULE, 1)
    results.push(result.ok)
    if (i <= 6 || i === 12) {
      console.log(`request ${String(i).padStart(2)}/12: ok=${result.ok} remaining=${result.remaining} retryAfter=${result.retryAfterSeconds}s`)
    }
  }

  const allowed = results.filter(Boolean).length
  const firstFiveOnly = results.slice(0, 5).every(Boolean) && results.slice(5).every(v => !v)

  const rows = await db.$queryRaw<Array<{ key: string; count: number | bigint }>>`
    SELECT "key", "count" FROM "RateLimitWindow" WHERE "key" LIKE ${`${RULE.name}:%`}`
  const row = rows[0]
  const rowOk = !!row && row.key === `${RULE.name}:${TEST_IP}` && Number(row.count) === 12

  // Cleanup: remove the verification window so the live table stays pristine.
  const deleted = await db.$executeRaw`DELETE FROM "RateLimitWindow" WHERE "key" LIKE ${`${RULE.name}:%`}`

  console.log(`\nallowed=${allowed}/12 (expected exactly 5) · window row: ${row ? `${row.key} count=${row.count}` : 'MISSING'} · cleaned rows: ${deleted}`)
  const ok = allowed === 5 && firstFiveOnly && rowOk
  console.log(`RESULT: ${ok ? 'PASS — atomic upsert windows work live (allowed first 5, blocked 6..12, row verified & cleaned)' : 'FAIL — see above'}`)
  process.exitCode = ok ? 0 : 1
}

main().finally(() => db.$disconnect().catch(() => {}))
