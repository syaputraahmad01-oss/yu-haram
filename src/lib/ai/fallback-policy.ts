/**
 * Pass 13 Phase 3: Real multi-provider coder fallback.
 *
 * Three cooperating pieces:
 *  1. classifyProviderFailure — maps every provider error to a failure kind,
 *     whether it may be retried on the SAME model, and any Retry-After hint.
 *  2. executeWithRetryPolicy — bounded retries with exponential backoff, full
 *     jitter and Retry-After compliance. Permanent failures never retry.
 *  3. CircuitBreaker — per provider+model failure tracking with open/half-open
 *     states so repeated hard failures take a candidate OUT of the fallback
 *     chain instead of burning the user's time and quota on it.
 */

import { createHmac, randomBytes } from 'node:crypto'
import { PROVIDERS } from '@/lib/constants/models'
import type { ProviderType } from '@/types'

export type ProviderFailureKind =
  | 'auth'                 // 401 — key rejected; retrying cannot help
  | 'permission'           // 403 — key lacks access; retrying cannot help
  | 'invalid_payload'      // 400/422 — our request is wrong for this model
  | 'model_unavailable'    // 404 — model not on this account/gateway
  | 'timeout'              // 408 / abort
  | 'too_large'            // 413
  | 'rate_limit'           // 429 — may succeed later
  | 'server'               // 5xx internal
  | 'gateway'              // 502
  | 'unavailable'          // 503
  | 'upstream_timeout'     // 504
  | 'context_overflow'     // context/token limit exceeded
  | 'truncation'           // output cut by maxOutputTokens
  | 'empty'                // provider answered without text
  | 'invalid_output'       // provider answered with unusable content
  | 'network'              // DNS/connect/TLS failures
  | 'unknown'

export interface ClassifiedProviderFailure {
  kind: ProviderFailureKind
  statusCode?: number
  /** Same-model retry is sensible (transient) vs moving to the next candidate. */
  retryableOnSameModel: boolean
  /** Server-provided Retry-After hint in ms, when the upstream sent one. */
  retryAfterMs?: number
  detail: string
}

const STATUS_KINDS: Record<number, ProviderFailureKind> = {
  401: 'auth',
  403: 'permission',
  400: 'invalid_payload',
  404: 'model_unavailable',
  408: 'timeout',
  413: 'too_large',
  422: 'invalid_payload',
  429: 'rate_limit',
  500: 'server',
  501: 'server',
  502: 'gateway',
  503: 'unavailable',
  504: 'upstream_timeout',
}

const PERMANENT: ReadonlySet<ProviderFailureKind> = new Set([
  'auth', 'permission', 'invalid_payload', 'model_unavailable', 'too_large', 'context_overflow',
])

const CONTEXT_OVERFLOW_PATTERN = /context.length|context.window|maximum context|too many tokens|token.limit|input.*exceed/i
const TRUNCATION_PATTERN = /maxOutputTokens|output.*limit|finishReason.*length|length.*finish/i

export function classifyProviderFailure(error: unknown): ClassifiedProviderFailure {
  const collected: { statuses: number[]; texts: string[] } = { statuses: [], texts: [] }
  const pending: unknown[] = [error]
  const visited = new Set<object>()
  let retryAfterMs: number | undefined

  while (pending.length && visited.size < 20) {
    const current = pending.shift()
    if (!current || typeof current !== 'object' || visited.has(current)) continue
    visited.add(current)
    const item = current as Record<string, unknown>
    if (typeof item.statusCode === 'number') collected.statuses.push(item.statusCode)
    if (item instanceof Error) collected.texts.push(item.message)
    for (const field of ['message', 'responseBody', 'text']) {
      if (typeof item[field] === 'string') collected.texts.push(item[field])
    }
    const headers = item.responseHeaders as Record<string, string> | undefined
    if (headers && typeof headers['retry-after'] === 'string') {
      const seconds = Number(headers['retry-after'])
      if (Number.isFinite(seconds) && seconds >= 0) retryAfterMs = seconds * 1000
    }
    if (typeof item.retryAfter === 'number') retryAfterMs = item.retryAfter
    pending.push(item.cause, item.lastError)
    if (Array.isArray(item.errors)) pending.push(...item.errors.slice(-10))
  }

  const statusCode = collected.statuses.at(-1)
  const text = collected.texts.join(' ').slice(0, 2000)
  const lower = text.toLowerCase()

  let kind: ProviderFailureKind | undefined
  if (statusCode != null && STATUS_KINDS[statusCode]) kind = STATUS_KINDS[statusCode]
  if (!kind && /aborted|abortedsignal|signal is abort/i.test(lower)) kind = 'timeout'
  if (!kind && CONTEXT_OVERFLOW_PATTERN.test(lower)) kind = 'context_overflow'
  if (!kind && TRUNCATION_PATTERN.test(lower)) kind = 'truncation'
  if (!kind && /empty response|no text|returned an empty response/i.test(lower)) kind = 'empty'
  if (!kind && /enotfound|econnrefused|econnreset|etimedout|fetch failed|network|tls|certificate/i.test(lower)) kind = 'network'
  if (!kind && /api[_ ]key|unauthorized|invalid_api_key/i.test(lower)) kind = 'auth'
  if (!kind) kind = 'unknown'

  return {
    kind,
    statusCode,
    retryableOnSameModel: !PERMANENT.has(kind) && kind !== 'empty' && kind !== 'invalid_output',
    retryAfterMs,
    detail: text || `unclassified ${kind}`,
  }
}

/* ------------------------------------------------------------------ */
/* Retry policy                                                        */
/* ------------------------------------------------------------------ */

export interface RetryPolicyOptions {
  maxAttempts: number
  baseDelayMs: number
  maxDelayMs?: number
  /** Injected for tests; defaults to real timers. */
  sleep?: (ms: number) => Promise<void>
  onRetry?: (attempt: number, failure: ClassifiedProviderFailure, delayMs: number) => void
}

/** Full-jitter exponential backoff honouring server Retry-After. */
export function backoffDelayMs(attempt: number, baseDelayMs: number, maxDelayMs = 15_000, retryAfterMs?: number): number {
  const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1))
  const jittered = Math.floor(Math.random() * exponential)
  if (retryAfterMs != null && retryAfterMs > 0) return Math.min(Math.max(retryAfterMs, jittered), 30_000)
  return jittered
}

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

export async function executeWithRetryPolicy<T>(
  operation: () => Promise<T>,
  options: RetryPolicyOptions,
): Promise<{ ok: true; value: T; attempts: number } | { ok: false; failure: ClassifiedProviderFailure; attempts: number }> {
  const sleep = options.sleep ?? defaultSleep
  let attempts = 0
  let lastFailure: ClassifiedProviderFailure | null = null

  while (attempts < Math.max(1, options.maxAttempts)) {
    attempts += 1
    try {
      const value = await operation()
      return { ok: true, value, attempts }
    } catch (error) {
      lastFailure = classifyProviderFailure(error)
      const canRetry = lastFailure.retryableOnSameModel && attempts < options.maxAttempts
      if (!canRetry) break
      const delayMs = backoffDelayMs(attempts, options.baseDelayMs, options.maxDelayMs, lastFailure.retryAfterMs)
      options.onRetry?.(attempts, lastFailure, delayMs)
      await sleep(delayMs)
    }
  }
  return { ok: false, failure: lastFailure ?? { kind: 'unknown', retryableOnSameModel: false, detail: 'no attempt recorded' }, attempts }
}

/* ------------------------------------------------------------------ */
/* Circuit breaker + provider cooldown                                 */
/* ------------------------------------------------------------------ */

export type CircuitState = 'closed' | 'open' | 'half-open'

export interface CircuitBreakerOptions {
  failureThreshold: number
  cooldownMs: number
  halfOpenMaxCalls?: number
  now?: () => number
}

interface CircuitRecord {
  state: CircuitState
  consecutiveFailures: number
  totalFailures: number
  totalSuccesses: number
  openedAt: number
  halfOpenCalls: number
  cooldownUntil: number
  lastErrorKind?: ProviderFailureKind
  lastErrorDetail?: string
}

export class CircuitBreaker {
  private record: CircuitRecord
  private readonly options: Required<CircuitBreakerOptions>

  constructor(public readonly key: string, options: CircuitBreakerOptions) {
    this.options = {
      failureThreshold: options.failureThreshold,
      cooldownMs: options.cooldownMs,
      halfOpenMaxCalls: options.halfOpenMaxCalls ?? 1,
      now: options.now ?? (() => Date.now()),
    }
    this.record = CircuitBreaker.seed()
  }

  private static seed(): CircuitRecord {
    return { state: 'closed', consecutiveFailures: 0, totalFailures: 0, totalSuccesses: 0, openedAt: 0, halfOpenCalls: 0, cooldownUntil: 0 }
  }

  get state(): CircuitState {
    if (this.record.state === 'open' && this.options.now() >= this.record.cooldownUntil) {
      this.record.state = 'half-open'
      this.record.halfOpenCalls = 0
    }
    return this.record.state
  }

  get snapshot(): Readonly<CircuitRecord> {
    return { ...this.record }
  }

  canCall(): boolean {
    const state = this.state
    if (state === 'closed') return true
    if (state === 'open') return false
    return this.record.halfOpenCalls < this.options.halfOpenMaxCalls
  }

  reserveHalfOpenCall(): boolean {
    if (this.state !== 'half-open') return this.canCall()
    if (this.record.halfOpenCalls >= this.options.halfOpenMaxCalls) return false
    this.record.halfOpenCalls += 1
    return true
  }

  recordSuccess(): void {
    this.record.consecutiveFailures = 0
    this.record.totalSuccesses += 1
    this.record.state = 'closed'
    this.record.halfOpenCalls = 0
  }

  recordFailure(failure: ClassifiedProviderFailure): void {
    const now = this.options.now()
    this.record.totalFailures += 1
    this.record.consecutiveFailures += 1
    this.record.lastErrorKind = failure.kind
    this.record.lastErrorDetail = failure.detail.slice(0, 300)
    // Permanent failures (auth/permission/model unavailable) open immediately:
    // hammering them only wastes the fallback budget.
    if (failure.retryableOnSameModel === false || this.record.consecutiveFailures >= this.options.failureThreshold) {
      this.record.state = 'open'
      this.record.openedAt = now
      this.record.cooldownUntil = now + (failure.kind === 'rate_limit' && failure.retryAfterMs ? Math.max(failure.retryAfterMs, this.options.cooldownMs) : this.options.cooldownMs)
    }
  }
}

const circuitRegistry = new Map<string, CircuitBreaker>()

/** Per-process salt for credential fingerprints. The breaker store is
 *  in-process, so a per-process salt keeps fingerprints stable for the life
 *  of the store while NEVER persisting a raw API key as an identifier.
 *  (YUHA_SECRET can pin it across restarts when an external store appears.) */
let fingerprintSalt: Buffer | null = null
export function credentialFingerprint(credential: string): string {
  if (!credential) return 'keyless'
  fingerprintSalt = fingerprintSalt ?? (process.env.YUHA_SECRET ? Buffer.from(process.env.YUHA_SECRET) : randomBytes(32))
  return createHmac('sha256', fingerprintSalt).update(credential).digest('hex').slice(0, 16)
}

/** Credential-scoped breaker key. Two users hammering the same provider:model
 *  with different keys get ISOLATED breakers, so one user's invalid key can
 *  never trip another user's circuit (Master Prompt 3.3). */
export function circuitScopeKey(provider: ProviderType, model: string, credential: string): string {
  return `${provider}:${model}:${credentialFingerprint(credential)}`
}

export function getCircuitBreaker(provider: ProviderType, model: string, credential = ''): CircuitBreaker {
  const key = circuitScopeKey(provider, model, credential)
  let breaker = circuitRegistry.get(key)
  if (!breaker) {
    breaker = new CircuitBreaker(key, { failureThreshold: 3, cooldownMs: 60_000 })
    circuitRegistry.set(key, breaker)
  }
  return breaker
}

/** Test-only: clear every breaker + cooldown. */
export function resetCircuitBreakers(): void {
  circuitRegistry.clear()
}

export function providerLabel(provider: ProviderType, model: string): string {
  return `${PROVIDERS[provider].name} (${model})`
}
