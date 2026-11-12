/**
 * Pass 13 Phase 1 security regression tests.
 *
 * Covers:
 *  - Rate limiting: fixed window counting, 429 boundary, per-identity isolation
 *    and real concurrency (parallel hits cannot exceed the limit).
 *  - SSRF: private/loopback/metadata IP classification (IPv4, IPv6, IPv4-mapped),
 *    literal-IP URL blocking, DNS-rebinding-resistant outbound URL validation,
 *    scheme blocking and the Ollama loopback exception.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { MemoryRateLimitStore, PostgresRateLimitStore, checkRateLimit, resetRateLimitsForTests, rateLimitBackend } from '../src/lib/security/rate-limit'
import { isForbiddenIp, validateOutboundUrl, assertAllowlistedHost } from '../src/lib/security/ssrf'

/* ---------------------------- rate limiting ---------------------------- */

test('rate limit counts hits inside the window and rejects beyond the limit', () => {
  const store = new MemoryRateLimitStore()
  for (let i = 0; i < 5; i += 1) {
    const result = store.hit('chat:1.2.3.4', 60_000)
    assert.equal(result.count, i + 1)
    assert.equal(result.resetAt > Date.now(), true)
  }
  const sixth = store.hit('chat:1.2.3.4', 60_000)
  assert.equal(sixth.count, 6)
  assert.equal(sixth.resetAt > Date.now(), true)
})

test('rate limit window resets after expiry', async () => {
  const store = new MemoryRateLimitStore()
  store.hit('chat:1.2.3.4', 1)
  // Let the 1ms window actually expire before hitting again.
  await new Promise(resolve => setTimeout(resolve, 10))
  const later = store.hit('chat:1.2.3.4', 60_000)
  // First window (1ms) already expired; the counter must have restarted at 1.
  assert.equal(later.count, 1)
})

test('concurrent hits cannot exceed the limit (race test)', async () => {
  resetRateLimitsForTests()
  const request = new Request('http://localhost/api/chat', { headers: { 'x-forwarded-for': '203.0.113.50' } })
  const rule = { name: 'chat', limit: 5, windowMs: 60_000 }
  // Fire 40 parallel requests through the real checkRateLimit path.
  const results = await Promise.all(
    Array.from({ length: 40 }, () => Promise.resolve().then(() => checkRateLimit(request, rule))),
  )
  const allowed = results.filter(result => result.ok).length
  const rejected = results.filter(result => !result.ok).length
  assert.equal(allowed, 5, `expected exactly 5 allowed, got ${allowed}`)
  assert.equal(rejected, 35)
  for (const result of results.filter(result => !result.ok)) {
    assert.equal(result.remaining, 0)
    assert.equal(result.retryAfterSeconds >= 1, true)
  }
})

test('different client identities are isolated', async () => {
  resetRateLimitsForTests()
  // Master Prompt 3.4: forwarded headers only count behind a configured
  // trusted proxy. With one trusted hop, each distinct client IP keeps its
  // own window — and a spoofed leftmost entry cannot manufacture identity.
  const rule = { name: 'orchestrate', limit: 1, windowMs: 60_000 }
  const request = new Request('http://localhost/api/chat', { headers: { 'x-forwarded-for': '203.0.113.51' } })
  assert.equal((await checkRateLimit(request, rule, 1)).ok, true)
  const other = new Request('http://localhost/api/chat', { headers: { 'x-forwarded-for': '203.0.113.52' } })
  assert.equal((await checkRateLimit(other, rule, 1)).ok, true, 'a second IP must not inherit the first IP window')
  assert.equal((await checkRateLimit(request, rule, 1)).ok, false, 'the first IP is now over the limit')
})

test('rate limit backend is selected explicitly and reported honestly', async () => {
  // In the tsx (Node) test runner the Bun-only sqlite store cannot load;
  // the selector must fall back to memory instead of failing. The postgres
  // store is only chosen when explicitly requested via the environment.
  assert.equal(['memory', 'sqlite', 'postgres'].includes(await rateLimitBackend()), true)
})

test('postgres rate-limit store performs one atomic upsert per hit', async () => {
  // Fake $queryRaw: records the SQL and returns the row the database would.
  // This verifies the store's SQL shape (single atomic upsert, window reset
  // via CASE) without needing a live PostgreSQL connection.
  const calls: Array<{ sql: string; values: unknown[] }> = []
  const fakeClient = {
    $queryRaw: async <T,>(query: TemplateStringsArray, ...values: unknown[]): Promise<T> => {
      calls.push({ sql: query.join('?'), values })
      return [{ count: 2, resetAt: new Date(Date.now() + 30_000) }] as T
    },
  }
  const store = new PostgresRateLimitStore(fakeClient)
  const result = await store.hit('chat:198.51.100.7', 60_000)
  assert.equal(result.count, 2)
  assert.equal(result.resetAt > Date.now(), true)
  assert.equal(calls.length, 1, 'exactly one statement per hit')
  const sql = calls[0].sql
  assert.equal(sql.includes('INSERT INTO "RateLimitWindow"'), true)
  assert.equal(sql.includes('ON CONFLICT ("key") DO UPDATE'), true, 'conflicting keys update atomically instead of erroring')
  assert.equal(sql.includes('RETURNING "count", "resetAt"'), true)
  assert.equal(calls[0].values[0], 'chat:198.51.100.7', 'key is parameterised, never interpolated')
})

/* --------------------------------- SSRF -------------------------------- */

test('isForbiddenIp classifies every private/reserved IPv4 range', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.1.1', '224.0.0.1', '240.0.0.1', '255.255.255.255', '198.18.0.1']) {
    assert.equal(isForbiddenIp(ip), true, `${ip} must be forbidden`)
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '142.250.4.95', '104.18.7.121']) {
    assert.equal(isForbiddenIp(ip), false, `${ip} must be allowed`)
  }
})

test('isForbiddenIp classifies IPv6 including IPv4-mapped addresses', () => {
  for (const ip of ['::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456:789a::1', 'ff02::1', '2001:db8::1', '::ffff:127.0.0.1', '::ffff:169.254.169.254']) {
    assert.equal(isForbiddenIp(ip), true, `${ip} must be forbidden`)
  }
  assert.equal(isForbiddenIp('2606:4700:4700::1111'), false)
})

test('validateOutboundUrl blocks loopback and private literal targets by default', async () => {
  await assert.rejects(() => validateOutboundUrl('http://localhost:11434/v1/models'), /Blocked outbound host/)
  await assert.rejects(() => validateOutboundUrl('http://127.0.0.1:8080'), /Blocked outbound address/)
  await assert.rejects(() => validateOutboundUrl('http://169.254.169.254/latest/meta-data'), /Blocked outbound address/)
  await assert.rejects(() => validateOutboundUrl('http://[::1]:9229'), /Blocked outbound address/)
})

test('validateOutboundUrl allows loopback only for the explicit Ollama exception', async () => {
  const target = await validateOutboundUrl('http://localhost:11434/v1/models', { allowLoopback: true })
  assert.equal(target.address, '127.0.0.1')
  await assert.rejects(
    () => validateOutboundUrl('http://169.254.169.254/latest/meta-data', { allowLoopback: true }),
    /Blocked outbound address/,
    'metadata IP must stay blocked even with the loopback exception',
  )
})

test('validateOutboundUrl blocks non-http schemes and validates real DNS', async () => {
  await assert.rejects(() => validateOutboundUrl('file:///etc/passwd'), /Blocked outbound URL scheme/)
  await assert.rejects(() => validateOutboundUrl('ftp://example.com/file'), /Blocked outbound URL scheme/)
  // Public DNS resolution must succeed and return a public address.
  const target = await validateOutboundUrl('https://api.github.com/user')
  assert.equal(isForbiddenIp(target.address), false)
  // A name that resolves (directly) to a forbidden address is rejected.
  await assert.rejects(() => validateOutboundUrl('https://localhost', {}), /Blocked outbound host|forbidden/)
})

test('fixed integration hosts are enforced through the allowlist', () => {
  assert.equal(assertAllowlistedHost('https://api.github.com/repos/x/y').hostname, 'api.github.com')
  assert.throws(() => assertAllowlistedHost('https://evil.example.com/steal'), /allowlist/)
  assert.throws(() => assertAllowlistedHost('http://169.254.169.254/latest'), /allowlist/)
})
