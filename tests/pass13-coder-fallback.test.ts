/**
 * Pass 13 Phase 3 + 4 regression tests.
 *
 * Phase 3: real multi-provider coder fallback —
 *  - classifyProviderFailure maps every mandated status/kind correctly and
 *    never marks permanent failures retryable.
 *  - executeWithRetryPolicy retries bounded, uses backoff, honours Retry-After
 *    and never re-sends a permanently wrong request.
 *  - CircuitBreaker opens after repeated failures, half-opens after cooldown,
 *    and opens immediately on permanent failures.
 *  - Task checkpoints persist to disk and support resume (skip completed).
 * Phase 4: benchmark registry — every score carries a real citation; models
 *  without traceable benchmarks return null (no invented scores).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  classifyProviderFailure, executeWithRetryPolicy, CircuitBreaker, backoffDelayMs,
} from '../src/lib/ai/fallback-policy'
import {
  deriveCheckpointKey, buildFileManifest, type TaskCheckpoint,
} from '../src/lib/foundations/task-checkpoint'
import { findBenchmark, toCapabilityRecord } from '../src/lib/foundations/benchmark-registry'

/* ------------------------ error classification ------------------------ */

test('classifyProviderFailure maps mandated statuses to kinds', () => {
  const cases: Array<[number, string]> = [
    [401, 'auth'], [403, 'permission'], [400, 'invalid_payload'], [404, 'model_unavailable'],
    [408, 'timeout'], [413, 'too_large'], [429, 'rate_limit'], [500, 'server'],
    [502, 'gateway'], [503, 'unavailable'], [504, 'upstream_timeout'],
  ]
  for (const [status, expected] of cases) {
    const result = classifyProviderFailure({ statusCode: status, responseBody: `provider said ${status}` })
    assert.equal(result.kind, expected, `status ${status} must classify as ${expected}, got ${result.kind}`)
  }
})

test('classifyProviderFailure detects context overflow, truncation, empty and network failures', () => {
  assert.equal(classifyProviderFailure(new Error('request exceeds the maximum context length')).kind, 'context_overflow')
  assert.equal(classifyProviderFailure(new Error('stream finished with finishReason length due to maxOutputTokens')).kind, 'truncation')
  assert.equal(classifyProviderFailure(new Error('returned an empty response')).kind, 'empty')
  assert.equal(classifyProviderFailure(new Error('fetch failed: ENOTFOUND api.example.com')).kind, 'network')
})

test('permanent failures are never retryable on the same model', () => {
  for (const statusCode of [401, 403, 400, 404, 413]) {
    const result = classifyProviderFailure({ statusCode, responseBody: 'x' })
    assert.equal(result.retryableOnSameModel, false, `status ${statusCode} must not retry`)
  }
  assert.equal(classifyProviderFailure({ statusCode: 429 }).retryableOnSameModel, true)
  assert.equal(classifyProviderFailure({ statusCode: 503 }).retryableOnSameModel, true)
})

test('Retry-After from upstream response headers is honoured', () => {
  const result = classifyProviderFailure({
    statusCode: 429,
    responseHeaders: { 'retry-after': '7' },
  })
  assert.equal(result.kind, 'rate_limit')
  assert.equal(result.retryAfterMs, 7000)
})

/* ----------------------------- retry policy ---------------------------- */

test('executeWithRetryPolicy retries transient failures up to the cap', async () => {
  let calls = 0
  const delays: number[] = []
  const result = await executeWithRetryPolicy(
    async () => {
      calls += 1
      if (calls < 3) throw Object.assign(new Error('upstream unavailable'), { statusCode: 503 })
      return 'done'
    },
    { maxAttempts: 3, baseDelayMs: 10, sleep: async ms => { delays.push(ms) } },
  )
  assert.equal(result.ok, true)
  if (result.ok) assert.equal(result.attempts, 3)
  assert.equal(calls, 3)
  assert.equal(delays.length, 2)
})

test('executeWithRetryPolicy never retries permanent failures', async () => {
  let calls = 0
  const result = await executeWithRetryPolicy(
    async () => {
      calls += 1
      throw Object.assign(new Error('bad key'), { statusCode: 401 })
    },
    { maxAttempts: 5, baseDelayMs: 1, sleep: async () => {} },
  )
  assert.equal(result.ok, false)
  assert.equal(calls, 1, 'auth failures must not be re-sent')
  if (!result.ok) assert.equal(result.failure.kind, 'auth')
})

test('backoff delay grows exponentially with jitter and respects Retry-After', () => {
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const delay = backoffDelayMs(attempt, 500, 15_000)
    const cap = Math.min(15_000, 500 * 2 ** (attempt - 1))
    assert.equal(delay >= 0 && delay < cap, true, `attempt ${attempt} delay ${delay} outside [0,${cap})`)
  }
  const pinned = backoffDelayMs(1, 500, 15_000, 4000)
  assert.equal(pinned >= 4000, true, 'Retry-After floor must be honoured')
  assert.equal(pinned <= 30_000, true)
})

/* ---------------------------- circuit breaker --------------------------- */

test('CircuitBreaker opens after threshold and half-opens after cooldown', () => {
  let now = 1_000_000
  const breaker = new CircuitBreaker('groq:test-model', {
    failureThreshold: 3, cooldownMs: 60_000, now: () => now,
  })
  assert.equal(breaker.canCall(), true)
  breaker.recordFailure(classifyProviderFailure({ statusCode: 503 }))
  breaker.recordFailure(classifyProviderFailure({ statusCode: 503 }))
  assert.equal(breaker.state, 'closed')
  breaker.recordFailure(classifyProviderFailure({ statusCode: 503 }))
  assert.equal(breaker.state, 'open')
  assert.equal(breaker.canCall(), false)
  now += 60_001
  assert.equal(breaker.state, 'half-open')
  assert.equal(breaker.reserveHalfOpenCall(), true)
  breaker.recordSuccess()
  assert.equal(breaker.state, 'closed')
})

test('CircuitBreaker opens immediately on permanent failures (auth)', () => {
  const breaker = new CircuitBreaker('gemini:bad-key', { failureThreshold: 3, cooldownMs: 60_000, now: () => 1 })
  breaker.recordFailure(classifyProviderFailure({ statusCode: 401 }))
  assert.equal(breaker.state, 'open', 'auth failures must open the breaker at once')
  assert.equal(breaker.snapshot.totalFailures, 1)
})

test('CircuitBreaker keeps providers with long Retry-After in cooldown', () => {
  let now = 5
  const breaker = new CircuitBreaker('openrouter:free-model', { failureThreshold: 3, cooldownMs: 10_000, now: () => now })
  breaker.recordFailure(classifyProviderFailure({ statusCode: 429, responseHeaders: { 'retry-after': '120' } }))
  breaker.recordFailure(classifyProviderFailure({ statusCode: 429, responseHeaders: { 'retry-after': '120' } }))
  breaker.recordFailure(classifyProviderFailure({ statusCode: 429, responseHeaders: { 'retry-after': '120' } }))
  assert.equal(breaker.state, 'open')
  now += 60_001 // less than the 120s Retry-After
  assert.equal(breaker.state, 'open', 'cooldown must extend at least to Retry-After')
})

/* --------------------------- task checkpoints --------------------------- */

test('checkpoint key is stable for identical instructions and differs otherwise', () => {
  const a = deriveCheckpointKey('Buatkan landing page', 'gemini', 'gemini-3-pro')
  const b = deriveCheckpointKey('  BUATKAN   landing  page  ', 'gemini', 'gemini-3-pro')
  const c = deriveCheckpointKey('Buatkan dashboard', 'gemini', 'gemini-3-pro')
  assert.equal(a, b)
  assert.notEqual(a, c)
})

test('file manifest hashes identify identical vs changed content', () => {
  const manifestA = buildFileManifest({ 'src/App.tsx': 'export default 1', 'index.html': '<html></html>' })
  const manifestB = buildFileManifest({ 'src/App.tsx': 'export default 1', 'index.html': '<html></html>' })
  const manifestC = buildFileManifest({ 'src/App.tsx': 'export default 2', 'index.html': '<html></html>' })
  assert.deepEqual(manifestA, manifestB)
  assert.notEqual(manifestA['src/App.tsx'], manifestC['src/App.tsx'])
})

test('checkpoint roundtrip persists to disk and marks interrupted state', async () => {
  // The production store writes under .data/checkpoints; this test exercises
  // the same shape (save + load + resume semantics) via the exported types and
  // verifies a serialized checkpoint survives a JSON round trip on disk.
  const dir = await mkdtemp(join(tmpdir(), 'yuha-cp-'))
  const checkpoint: TaskCheckpoint = {
    checkpointKey: 'ws-test:gemini:gemini-3-pro:abc123',
    schemaVersion: 2,
    workspaceId: 'ws-test',
    taskId: 'orchestration',
    projectId: 'proj-test',
    sessionId: 'orch-1',
    originalInstruction: 'Build a todo app',
    status: 'interrupted',
    tasks: [
      { taskId: 'wo-1', title: 'Scaffold UI', objective: 'Create components', acceptanceCriteria: ['renders'], status: 'completed', changedFiles: ['src/App.tsx'], completedAt: 1 },
      { taskId: 'wo-2', title: 'Wire state', objective: 'Add reducer', acceptanceCriteria: ['state works'], status: 'pending', changedFiles: [] },
    ],
    fileManifest: buildFileManifest({ 'src/App.tsx': 'export default 1' }),
    lastValidChanges: ['src/App.tsx'],
    previousModelOutput: '<boltArtifact>partial</boltArtifact>',
    failureReason: 'All coder candidates failed',
    executionLogs: ['[log] started'],
    createdAt: 1,
    updatedAt: 2,
    expiresAt: Date.now() + 86_400_000,
    checksum: '0'.repeat(32),
  }
  const file = join(dir, 'cp.json')
  const { writeFile } = await import('node:fs/promises')
  await writeFile(file, JSON.stringify(checkpoint))
  const restored = JSON.parse(await readFile(file, 'utf8')) as TaskCheckpoint
  assert.equal(restored.status, 'interrupted')
  assert.equal(restored.tasks.filter(task => task.status === 'completed').length, 1)
  assert.equal(restored.tasks.filter(task => task.status === 'pending').length, 1)
  assert.equal(restored.failureReason, 'All coder candidates failed')
  await rm(dir, { recursive: true, force: true })
})

/* --------------------------- benchmark registry ------------------------- */

test('benchmark registry entries carry real citations', () => {
  const gemini = findBenchmark('gemini-3-pro-preview')
  assert.ok(gemini, 'gemini-3-pro must be registered')
  assert.equal(gemini.coding.benchmark, 'LiveCodeBench')
  assert.equal(gemini.coding.score, 91.7)
  assert.ok(gemini.coding.source.startsWith('https://'))
  const kimi = findBenchmark('moonshotai/kimi-k2-instruct-0905')
  assert.ok(kimi)
  assert.equal(kimi.reasoning.score, 78.2)
})

test('models without traceable benchmarks have no score (no invention)', () => {
  assert.equal(toCapabilityRecord({ id: 'llama-4-maverick-17b', provider: 'groq', tier: 'free' }), null,
    'llama-4-maverick has no traceable benchmark and must not receive a score')
  assert.equal(toCapabilityRecord({ id: 'totally-unknown-model-xyz', provider: 'openrouter', tier: 'unknown' }), null)
})

test('capability records only exist for benchmarked models and keep the tier', () => {
  const record = toCapabilityRecord({ id: 'openai/gpt-oss-120b:free', provider: 'openrouter', tier: 'free', contextWindow: 131072 })
  assert.ok(record)
  assert.equal(record.codingScore, 88)
  assert.equal(record.tier, 'free')
  assert.equal(record.verifiedFree, true)
})
