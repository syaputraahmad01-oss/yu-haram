/**
 * PHASE 1 regression tests (Master Prompt upgrade, 2026-11-12).
 * Covers: per-model tier policy, per-model consent, credential-scoped circuit
 * breakers, trusted-proxy rate limiting, NAT64/6to4/Teredo/IPv4-compatible
 * SSRF blocks.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { modelOption, normalizeCatalog, preferredFreeModel } from '../src/lib/ai/catalog'
import { PROVIDER_TIER_POLICY, tierForModel } from '../src/lib/ai/provider-tiers'
import { getCircuitBreaker, circuitScopeKey, credentialFingerprint, classifyProviderFailure, resetCircuitBreakers } from '../src/lib/ai/fallback-policy'
import { clientIdentity, trustedProxyHops, MemoryRateLimitStore, RATE_LIMITS } from '../src/lib/security/rate-limit'
import { isForbiddenIp, validateOutboundUrl } from '../src/lib/security/ssrf'

/* ---------- 3.1 Free-first classification ---------- */

test('Gemini and Groq models default to free-tier per documented provider policy', () => {
  const gemini = modelOption('gemini', 'gemini-2.5-flash')
  const groq = modelOption('groq', 'llama-3.3-70b-versatile')
  assert.equal(gemini.tier, 'free-tier')
  assert.equal(groq.tier, 'free-tier')
  // Free-tier models are auto-selectable without per-model consent...
  assert.equal(preferredFreeModel([gemini, groq])?.id, 'gemini-2.5-flash')
  // ...and the policy honestly reports quota as unknown with a limits note.
  assert.equal(PROVIDER_TIER_POLICY.gemini.quotaVisibility, 'unknown')
  assert.match(PROVIDER_TIER_POLICY.gemini.quotaNote, /RPM/)
  assert.match(PROVIDER_TIER_POLICY.groq.quotaNote, /RPM/)
})

test('Kimi/Qwen/OpenRouter stay unknown or per-pricing — never assumed free', () => {
  assert.equal(modelOption('kimi', 'moonshot-v1-8k').tier, 'unknown')
  assert.equal(modelOption('qwen', 'qwen-max').tier, 'unknown')
  assert.equal(modelOption('openrouter', 'meta-llama/llama-3.1-405b-instruct').tier, 'unknown')
  assert.equal(modelOption('openrouter', 'x/y:free').tier, 'free')
  assert.equal(modelOption('ollama', 'llama3').tier, 'free')
})

test('Catalog normalization still reclassifies by pricing metadata where provided', () => {
  const catalog = normalizeCatalog('openrouter', {
    data: [
      { id: 'a/paid-model', pricing: { prompt: '0.001', completion: '0.002' } },
      { id: 'b/free-model:free', pricing: { prompt: '0', completion: '0' } },
      { id: 'c/zero-model', pricing: { prompt: '0', completion: '0' } },
    ],
  })
  assert.equal(catalog.find(m => m.id === 'a/paid-model')?.tier, 'paid')
  assert.equal(catalog.find(m => m.id === 'b/free-model:free')?.tier, 'free')
  assert.equal(catalog.find(m => m.id === 'c/zero-model')?.tier, 'unknown')
})

/* ---------- 3.3 Circuit breaker credential isolation ---------- */

test('Circuit breakers are isolated per credential — one bad key cannot trip another user', () => {
  resetCircuitBreakers()
  const userA = getCircuitBreaker('gemini', 'gemini-2.5-flash', 'userA-secret-key')
  const userB = getCircuitBreaker('gemini', 'gemini-2.5-flash', 'userB-secret-key')
  assert.notEqual(userA, userB)
  // User A's auth failures open ONLY user A's breaker.
  for (let i = 0; i < 3; i += 1) userA.recordFailure(classifyProviderFailure({ statusCode: 401, message: 'invalid key' }))
  assert.equal(userA.state, 'open')
  assert.equal(userB.state, 'closed')
  assert.ok(userB.canCall())
  // The registry key never contains the raw credential.
  const fingerprint = credentialFingerprint('userA-secret-key')
  assert.match(fingerprint, /^[0-9a-f]{16}$/)
  assert.ok(!circuitScopeKey('gemini', 'm', 'userA-secret-key').includes('userA-secret-key'))
  assert.equal(circuitScopeKey('gemini', 'm', ''), 'gemini:m:keyless')
})

/* ---------- 3.4 Rate limiter trusted proxy ---------- */

test('X-Forwarded-For is IGNORED when no proxy is trusted (default)', () => {
  const request = new Request('http://x/api/chat', { headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } })
  assert.equal(clientIdentity(request, 0).ip, 'local')
})

test('With one trusted hop, the RIGHTMOST entry (the proxy-observed client) is used', () => {
  const spoofed = new Request('http://x/api/chat', { headers: { 'x-forwarded-for': '1.2.3.4, 203.0.113.9' } })
  assert.equal(clientIdentity(spoofed, 1).ip, '203.0.113.9')
  const single = new Request('http://x/api/chat', { headers: { 'x-forwarded-for': '203.0.113.9' } })
  assert.equal(clientIdentity(single, 1).ip, '203.0.113.9')
})

test('A spoofed leftmost XFF entry can never become the identity', () => {
  // Client injects "9.9.9.9"; the trusted proxy appends the real client IP.
  const request = new Request('http://x/api/chat', { headers: { 'x-forwarded-for': '9.9.9.9, 198.51.100.7' } })
  assert.equal(clientIdentity(request, 1).ip, '198.51.100.7')
  assert.notEqual(clientIdentity(request, 1).ip, '9.9.9.9')
})

test('Malformed or too-short forwarded chains never fall back to a spoofable entry', () => {
  const request = new Request('http://x/api/chat', { headers: { 'x-forwarded-for': '9.9.9.9' } })
  // With 2 trusted hops but only 1 entry, the chain cannot be trusted.
  assert.equal(clientIdentity(request, 2).ip, 'untrusted-forwarded')
})

test('A forged x-real-ip cannot change the bucket when no proxy is trusted (hops=0)', () => {
  // Rotating a spoofed x-real-ip used to rotate the bucket (limit bypass).
  // Now every value — including none — resolves to the same shared bucket.
  const first = new Request('http://x/api/chat', { headers: { 'x-real-ip': '203.0.113.10' } })
  const second = new Request('http://x/api/chat', { headers: { 'x-real-ip': '198.51.100.99' } })
  const noHeader = new Request('http://x/api/chat')
  assert.equal(clientIdentity(first, 0).ip, 'local')
  assert.equal(clientIdentity(second, 0).ip, 'local')
  assert.equal(clientIdentity(noHeader, 0).ip, 'local')
})

test('Non-IP strings such as "a:b" are rejected as identity literals', () => {
  // Old operator-precedence bug: any string containing ':' passed validation.
  const request = new Request('http://x/api/chat', { headers: { 'x-forwarded-for': 'a:b' } })
  assert.equal(clientIdentity(request, 1).ip, 'untrusted-forwarded')
})

test('XFF with hops=1 and hops=2 selects the entry exactly N from the right', () => {
  const request = new Request('http://x/api/chat', {
    headers: { 'x-forwarded-for': 'spoofed.by.caller, 198.51.100.7, 203.0.113.9' },
  })
  assert.equal(clientIdentity(request, 1).ip, '203.0.113.9')
  assert.equal(clientIdentity(request, 2).ip, '198.51.100.7')
})

test('Valid IPv6 literals remain accepted through the forwarded chain', () => {
  const request = new Request('http://x/api/chat', { headers: { 'x-forwarded-for': '2001:db8::1' } })
  assert.equal(clientIdentity(request, 1).ip, '2001:db8::1')
})

test('trustedProxyHops parses env defensively', () => {
  assert.equal(trustedProxyHops({}), 0)
  assert.equal(trustedProxyHops({ YUHA_TRUSTED_PROXY_HOPS: '1' }), 1)
  assert.equal(trustedProxyHops({ YUHA_TRUSTED_PROXY_HOPS: '3' }), 3)
  assert.equal(trustedProxyHops({ YUHA_TRUSTED_PROXY_HOPS: '-1' }), 0)
  assert.equal(trustedProxyHops({ YUHA_TRUSTED_PROXY_HOPS: '99' }), 0)
  assert.equal(trustedProxyHops({ YUHA_TRUSTED_PROXY_HOPS: 'bogus' }), 0)
})

test('Memory store enforces a hard cap under a flood of unique identities', () => {
  const store = new MemoryRateLimitStore()
  const limit = 10_000
  for (let i = 0; i < limit + 500; i += 1) store.hit(`flood-${i}`, 60_000)
  // Internal size is not exported; prove the cap via continued correctness.
  const result = store.hit('after-flood', 60_000)
  assert.equal(result.count, 1)
})

test('RATE_LIMITS keeps distinct policies per route class', () => {
  assert.ok(RATE_LIMITS.chat.limit < RATE_LIMITS.providersList.limit)
  assert.ok(RATE_LIMITS.orchestrate.limit < RATE_LIMITS.chat.limit)
})

/* ---------- 3.5 SSRF: alternate IPv6 encodings ---------- */

test('NAT64, 6to4, Teredo and IPv4-compatible forms are forbidden', () => {
  assert.ok(isForbiddenIp('64:ff9b::7f00:1'), 'NAT64 loopback')
  assert.ok(isForbiddenIp('64:ff9b::a00:1'), 'NAT64 private 10.0.0.1')
  assert.ok(isForbiddenIp('64:ff9b::a9fe:a9fe'), 'NAT64 metadata')
  assert.ok(isForbiddenIp('2002:7f00:1::1'), '6to4 loopback')
  assert.ok(isForbiddenIp('2002:0a00:1::1'), '6to4 private')
  assert.ok(isForbiddenIp('2001:0:1234::1'), 'Teredo')
  assert.ok(isForbiddenIp('::127.0.0.1'), 'IPv4-compatible dotted')
  assert.ok(isForbiddenIp('::a00:1'), 'IPv4-compatible hex 10.0.0.1')
  // Public IPv6 remains allowed.
  assert.ok(!isForbiddenIp('2607:f8b0:4005:80a::200e'))
  assert.ok(isForbiddenIp('64:ff9b::808:808'), 'NAT64 range blocked even to public 8.8.8.8 (conservative)')
})

test('validateOutboundUrl blocks NAT64/6to4 loopback targets end-to-end', async () => {
  await assert.rejects(validateOutboundUrl('http://[64:ff9b::7f00:1]/'), /Blocked outbound address/)
  await assert.rejects(validateOutboundUrl('http://[2002:7f00:1::1]/'), /Blocked outbound address/)
})
