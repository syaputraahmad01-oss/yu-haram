/**
 * Search router with ordered fallback (Master Prompt 9.3).
 *
 * User-configurable provider order. On failure the SAME query moves to the
 * next provider; failures are classified distinctly (auth ≠ quota ≠ rate
 * limit ≠ network ≠ outage) and a circuit breaker per provider+credential
 * takes a failing provider out of the rotation temporarily. Results from all
 * successful providers are merged, deduplicated and ranked.
 */

import { CircuitBreaker, credentialFingerprint } from '@/lib/ai/fallback-policy'
import { SEARCH_ADAPTERS, firecrawlAdapter, ResearchError } from './adapters'
import { mergeAndRankResults } from './normalize'
import type { ExtractedContent, ResearchFailure, ResearchProviderId, SearchResult } from './types'

const breakers = new Map<string, CircuitBreaker>()

function breakerFor(provider: ResearchProviderId, credential: string): CircuitBreaker {
  const key = `research:${provider}:${credentialFingerprint(credential)}`
  let breaker = breakers.get(key)
  if (!breaker) {
    breaker = new CircuitBreaker(key, { failureThreshold: 3, cooldownMs: 60_000 })
    breakers.set(key, breaker)
  }
  return breaker
}

/** Test-only. */
export function resetResearchBreakers(): void {
  breakers.clear()
}

function toResearchFailure(provider: ResearchProviderId, error: unknown): ResearchFailure {
  if (error instanceof ResearchError) return { provider, kind: error.kind, detail: error.message }
  const message = error instanceof Error ? error.message : String(error)
  const kind = /timeout|aborted/i.test(message) ? 'timeout'
    : /fetch failed|network|enotfound|econn|tls/i.test(message) ? 'network'
    : /EYUHA_BLOCKED|blocked/i.test(message) ? 'blocked'
    : 'invalid_response'
  return { provider, kind, detail: message.slice(0, 300) }
}

export interface RouterSearchOptions {
  /** User-ordered provider ids; each must have its key present (or be keyless). */
  order: ResearchProviderId[]
  /** Per-provider credentials from the request. */
  credentials: Partial<Record<ResearchProviderId, string>>
  maxResults: number
  searxngBaseUrl?: string
  signal?: AbortSignal
}

export interface RoutedSearchOutcome {
  results: SearchResult[]
  failures: ResearchFailure[]
  /** Providers that answered successfully, in attempt order. */
  usedProviders: ResearchProviderId[]
}

export async function searchWithFallback(query: string, options: RouterSearchOptions): Promise<RoutedSearchOutcome> {
  const failures: ResearchFailure[] = []
  const usedProviders: ResearchProviderId[] = []
  const batches: SearchResult[][] = []
  let remaining = Math.max(1, options.maxResults)

  for (const provider of options.order) {
    const adapter = SEARCH_ADAPTERS[provider]
    if (!adapter) continue
    const credential = options.credentials[provider] ?? ''
    if (adapter.meta.needsKey && !credential) {
      failures.push({ provider, kind: 'auth', detail: `${adapter.meta.name} tidak memiliki API key tersimpan; dilewati.` })
      continue
    }
    const breaker = breakerFor(provider, credential)
    if (!breaker.canCall()) {
      failures.push({ provider, kind: 'rate_limit', detail: `${adapter.meta.name} sedang dalam cooldown circuit breaker; dilewati sementara.` })
      continue
    }
    try {
      const batch = await adapter.search(query, credential, {
        maxResults: remaining,
        searxngBaseUrl: options.searxngBaseUrl,
        signal: options.signal,
      })
      breaker.recordSuccess()
      if (batch.length > 0) {
        batches.push(batch)
        usedProviders.push(provider)
        remaining = Math.max(0, options.maxResults - batch.length)
      }
      if (remaining === 0) break
    } catch (error) {
      const failure = toResearchFailure(provider, error)
      breaker.recordFailure({ kind: 'rate_limit', retryableOnSameModel: true, detail: failure.detail })
      failures.push(failure)
      // Same query, same intent: continue to the next provider.
    }
  }

  const results = mergeAndRankResults(batches, { maxResults: options.maxResults })
  return { results, failures, usedProviders }
}

/** Firecrawl extraction — one URL, framed as untrusted data downstream. */
export async function extractContent(url: string, credential: string, signal?: AbortSignal): Promise<ExtractedContent> {
  if (!credential) throw new ResearchError('auth', 'Firecrawl membutuhkan API key.')
  const breaker = breakerFor('firecrawl', credential)
  if (!breaker.canCall()) throw new ResearchError('rate_limit', 'Firecrawl sedang dalam cooldown circuit breaker.')
  try {
    const content = await firecrawlAdapter.extract(url, credential, signal)
    breaker.recordSuccess()
    return content
  } catch (error) {
    const failure = toResearchFailure('firecrawl', error)
    breaker.recordFailure({ kind: 'rate_limit', retryableOnSameModel: true, detail: failure.detail })
    throw error
  }
}
