/**
 * Rate limiting for YUHA API routes.
 *
 * Design contract:
 *  - `checkRateLimit` is called at the top of every mutating API route.
 *  - Identity follows the trusted-proxy policy: with
 *    YUHA_TRUSTED_PROXY_HOPS=N (N>0) the client is the Nth entry counted
 *    from the RIGHT of x-forwarded-for (the rightmost-trusted algorithm).
 *    With the default 0 (no proxy trusted) ALL forwarded headers
 *    (x-real-ip, x-forwarded-for) are IGNORED because a direct client
 *    controls them; the direct connection identity is used when the
 *    runtime exposes it, else every direct client shares the "local" bucket.
 *  - Three backends implement `RateLimitStore`:
 *      * memory   — per-process fixed window. Default; correct for the
 *        documented single-server deployment (a lone `next start`).
 *      * sqlite   — file-backed fixed window shared by every process on the
 *        host (Bun runtime only; YUHA_RATE_LIMIT_BACKEND=sqlite).
 *      * postgres — windows shared through the Supabase PostgreSQL database
 *        (YUHA_RATE_LIMIT_BACKEND=postgres); the right choice for
 *        multi-instance deployments. Reuses the app database, so no new
 *        vendor/service is introduced.
 *    A multi-machine deployment that keeps the default memory backend does
 *    NOT get a shared limit — the selector never pretends otherwise.
 *  - `hit()` may be async (postgres backend), so `checkRateLimit` is async;
 *    memory/sqlite results are returned unwrapped via the same interface.
 *  - No dynamic state is ever read from untrusted request bodies here.
 */

import { isIP } from 'node:net'

type MaybePromise<T> = T | Promise<T>

export interface RateLimitStore {
  /** Count one hit for `key` inside `windowMs`. Returns current window state. */
  hit(key: string, windowMs: number): MaybePromise<{ count: number; resetAt: number }>
}

const MAX_ENTRIES = 10_000

export class MemoryRateLimitStore implements RateLimitStore {
  private windows = new Map<string, { count: number; resetAt: number }>()

  hit(key: string, windowMs: number): { count: number; resetAt: number } {
    const now = Date.now()
    const existing = this.windows.get(key)
    if (existing && existing.resetAt > now) {
      existing.count += 1
      return { count: existing.count, resetAt: existing.resetAt }
    }
    const fresh = { count: 1, resetAt: now + windowMs }
    this.windows.set(key, fresh)
    if (this.windows.size > MAX_ENTRIES) {
      // Hard memory cap (Master Prompt 3.4.7/8): first drop expired windows,
      // then — if still over cap — drop the OLDEST insertions (Map keeps
      // insertion order). The map can never grow unbounded.
      for (const [entryKey, entry] of this.windows) {
        if (this.windows.size <= MAX_ENTRIES) break
        if (entry.resetAt <= now) this.windows.delete(entryKey)
      }
      for (const entryKey of this.windows.keys()) {
        if (this.windows.size <= MAX_ENTRIES) break
        this.windows.delete(entryKey)
      }
    }
    return { count: fresh.count, resetAt: fresh.resetAt }
  }

  reset(): void {
    this.windows.clear()
  }
}

/** Bun-native SQLite store; shared across processes on the same host. */
interface BunSqliteDatabase {
  query: (sql: string) => { run: (...args: unknown[]) => unknown; get: (...args: unknown[]) => unknown }
}

/** Isolated loader so the bun:sqlite module name never appears in a type position. */
function loadBunSqlite(): { Database: new (path: string, options?: { create?: boolean }) => BunSqliteDatabase } {
  const dynamicRequire = new Function('return require')() as (id: string) => { Database: new (path: string, options?: { create?: boolean }) => BunSqliteDatabase }
  return dynamicRequire('bun:sqlite')
}

export class SqliteRateLimitStore implements RateLimitStore {
  private db: BunSqliteDatabase
  readonly backend = 'sqlite' as const

  constructor(path: string) {
    // Guarded native import: only available under the Bun runtime.
    // Node-based type checking and tests compile without a bun:sqlite type.
    const { Database } = loadBunSqlite()
    this.db = new Database(path, { create: true })
    this.db.query('CREATE TABLE IF NOT EXISTS rate_limit_windows (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL)').run()
  }

  hit(key: string, windowMs: number): { count: number; resetAt: number } {
    const now = Date.now()
    const row = this.db.query('SELECT count, reset_at FROM rate_limit_windows WHERE key = ?').get(key) as { count: number; reset_at: number } | null
    if (row && row.reset_at > now) {
      const count = row.count + 1
      this.db.query('UPDATE rate_limit_windows SET count = ? WHERE key = ?').run(count, key)
      return { count, resetAt: row.reset_at }
    }
    const resetAt = now + windowMs
    this.db.query('INSERT OR REPLACE INTO rate_limit_windows (key, count, reset_at) VALUES (?, 1, ?)').run(key, resetAt)
    return { count: 1, resetAt }
  }
}

let memoryStore: MemoryRateLimitStore | null = null
let sharedStore: RateLimitStore | null = null
let sharedStoreBackend: 'memory' | 'sqlite' | 'postgres' | null = null

/** Structural slice of PrismaClient the postgres store needs — keeps the
 * store unit-testable without a live database connection. */
interface RawQueryClient {
  $queryRaw: <T>(query: TemplateStringsArray, ...values: unknown[]) => Promise<T>
}

/** Shared-window store backed by the Supabase PostgreSQL database.
 * One atomic INSERT ... ON CONFLICT upsert per hit — correct under concurrency
 * across every YUHA instance connected to the same database. */
export class PostgresRateLimitStore implements RateLimitStore {
  constructor(private readonly client: RawQueryClient) {}

  readonly backend = 'postgres' as const

  async hit(key: string, windowMs: number): Promise<{ count: number; resetAt: number }> {
    const resetAt = new Date(Date.now() + windowMs)
    const rows = await this.client.$queryRaw<Array<{ count: number | bigint; resetAt: Date }>>`
      INSERT INTO "RateLimitWindow" ("key", "count", "resetAt")
      VALUES (${key}, 1, ${resetAt})
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "RateLimitWindow"."resetAt" > now() THEN "RateLimitWindow"."count" + 1 ELSE 1 END,
        "resetAt" = CASE WHEN "RateLimitWindow"."resetAt" > now() THEN "RateLimitWindow"."resetAt" ELSE ${resetAt} END
      RETURNING "count", "resetAt"`
    const row = rows[0]
    return { count: Number(row.count), resetAt: new Date(row.resetAt).getTime() }
  }
}

async function getStore(): Promise<{ store: RateLimitStore; backend: 'memory' | 'sqlite' | 'postgres' }> {
  if (!sharedStore) {
    const requested = process.env.YUHA_RATE_LIMIT_BACKEND
    if (requested === 'sqlite') {
      try {
        sharedStore = new SqliteRateLimitStore(process.env.YUHA_RATE_LIMIT_DB || 'db/rate-limit.sqlite')
        sharedStoreBackend = 'sqlite'
        return { store: sharedStore, backend: sharedStoreBackend }
      } catch {
        // Bun-only store requested outside Bun (e.g. tsx test runner): fall back honestly.
        sharedStore = null
        sharedStoreBackend = null
      }
    }
    if (requested === 'postgres') {
      // Lazy import: the default (memory) path never loads the database client.
      const { db } = await import('../db')
      sharedStore = new PostgresRateLimitStore(db)
      sharedStoreBackend = 'postgres'
      return { store: sharedStore, backend: sharedStoreBackend }
    }
    if (!sharedStore) {
      memoryStore = memoryStore ?? new MemoryRateLimitStore()
      sharedStore = memoryStore
      sharedStoreBackend = 'memory'
    }
  }
  return { store: sharedStore, backend: sharedStoreBackend ?? 'memory' }
}

export async function rateLimitBackend(): Promise<'memory' | 'sqlite' | 'postgres'> {
  return (await getStore()).backend
}

export interface ClientIdentity {
  /** Bucket key component; never contains raw credentials. */
  ip: string
}

/** A valid IPv4 or IPv6 literal (no hostnames, no port lists, no "a:b"). */
function isValidIpLiteral(value: string): boolean {
  return isIP(value) !== 0
}

/** How many reverse-proxy hops in front of the app the operator trusts.
 *  Parsed once from YUHA_TRUSTED_PROXY_HOPS ("0" default = trust no proxy:
 *  forwarded headers are IGNORED and direct-connection identity is used).
 *  With N trusted hops, the CLIENT is the (N)th address from the RIGHT of
 *  X-Forwarded-For — the standard rightmost-trusted algorithm. A spoofed
 *  leftmost entry ("1.2.3.4" injected by the caller) can never be selected
 *  because it sits on the untrusted side. */
export function trustedProxyHops(env: Record<string, string | undefined> = process.env): number {
  const raw = Number(env.YUHA_TRUSTED_PROXY_HOPS)
  return Number.isInteger(raw) && raw >= 0 && raw <= 8 ? raw : 0
}

export function clientIdentity(request: Request, hops = trustedProxyHops()): ClientIdentity {
  if (hops > 0) {
    const forwarded = request.headers.get('x-forwarded-for')
    if (forwarded) {
      // Rightmost entries are appended by OUR trusted proxies; take the one
      // exactly `hops` positions from the right. Only valid IP literals count.
      const entries = forwarded.split(',').map(entry => entry.trim()).filter(Boolean)
      const client = entries[entries.length - hops]
      if (client && isValidIpLiteral(client)) return { ip: client.slice(0, 64) }
      // Malformed/short chain: do NOT silently fall back to a spoofable entry.
      return { ip: 'untrusted-forwarded' }
    }
  }
  // hops === 0 (or trusted hops without a forwarded header): direct
  // connection. EVERY forwarded header is client-controlled and is IGNORED —
  // a direct client can forge x-real-ip / x-forwarded-for at will, and
  // honouring them would let the caller dodge the limit by rotating values.
  // On a public deployment the operator MUST set YUHA_TRUSTED_PROXY_HOPS to
  // the real proxy count, otherwise all direct clients share one bucket.
  const direct = directConnectionIp(request)
  return { ip: direct ?? 'local' }
}

/** Best-effort direct (socket) connection address. The Web-standard Request
 *  carries no connection info, so under Next.js route handlers this returns
 *  null and the caller falls back to the single shared 'local' bucket. If a
 *  runtime/adapter ever attaches the socket to the request, its remote
 *  address is used — that address cannot be forged by header injection. */
function directConnectionIp(request: Request): string | null {
  const socket = (request as { socket?: { remoteAddress?: unknown } }).socket
  if (socket && typeof socket.remoteAddress === 'string' && isValidIpLiteral(socket.remoteAddress)) {
    return socket.remoteAddress
  }
  return null
}

export interface RateLimitRule {
  /** Logical bucket name, e.g. "chat". Combined with identity + window. */
  name: string
  limit: number
  windowMs: number
}

export interface RateLimitResult {
  ok: boolean
  limit: number
  remaining: number
  resetAt: number
  retryAfterSeconds: number
}

export async function checkRateLimit(request: Request, rule: RateLimitRule, hops?: number): Promise<RateLimitResult> {
  const { store } = await getStore()
  const { ip } = clientIdentity(request, hops)
  const { count, resetAt } = await store.hit(`${rule.name}:${ip}`, rule.windowMs)
  const remaining = Math.max(0, rule.limit - count)
  return {
    ok: count <= rule.limit,
    limit: rule.limit,
    remaining,
    resetAt,
    retryAfterSeconds: Math.max(1, Math.ceil((resetAt - Date.now()) / 1000)),
  }
}

/** Standard 429 response builder with the exact headers a client needs. */
export function rateLimitedResponse(result: RateLimitResult): Response {
  return Response.json(
    { error: `Terlalu banyak permintaan. Coba lagi dalam ${result.retryAfterSeconds} detik.` },
    {
      status: 429,
      headers: {
        'Retry-After': String(result.retryAfterSeconds),
        'X-RateLimit-Limit': String(result.limit),
        'X-RateLimit-Remaining': String(result.remaining),
        'X-RateLimit-Reset': String(Math.ceil(result.resetAt / 1000)),
        'Cache-Control': 'no-store',
      },
    },
  )
}

/** Shared rules so routes and tests agree on the numbers. */
export const RATE_LIMITS = {
  providersList: { name: 'providers-list', limit: 60, windowMs: 60_000 },
  providersTest: { name: 'providers-test', limit: 15, windowMs: 60_000 },
  chat: { name: 'chat', limit: 12, windowMs: 60_000 },
  orchestrate: { name: 'orchestrate', limit: 8, windowMs: 60_000 },
  githubCommit: { name: 'github-commit', limit: 6, windowMs: 60_000 },
  githubRepos: { name: 'github-repos', limit: 30, windowMs: 60_000 },
  deploy: { name: 'deploy', limit: 10, windowMs: 60_000 },
  research: { name: 'research', limit: 10, windowMs: 60_000 },
  health: { name: 'health', limit: 30, windowMs: 60_000 },
} satisfies Record<string, RateLimitRule>

/** Test-only helper: drop every window so tests start from a clean slate. */
export function resetRateLimitsForTests(): void {
  memoryStore?.reset()
}
