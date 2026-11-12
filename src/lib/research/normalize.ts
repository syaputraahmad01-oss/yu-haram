/**
 * Search-result normalization: canonical URLs, deduplication, merging and
 * honest ranking (Master Prompt 9.5/9.6). No fabricated dates, authors or
 * scores — fields absent from the provider payload stay undefined.
 */

import type { SearchResult } from './types'

const TRACKING_PARAMS = /^(?:utm_[a-z_]+|gclid|fbclid|mc_cid|mc_eid|ref|ref_src|igshid|si)$/i

/** Canonical dedup key: scheme/host normalized, tracking params dropped. */
export function canonicalizeUrl(raw: string): string {
  try {
    const url = new URL(raw)
    url.hash = ''
    url.protocol = url.protocol.toLowerCase()
    url.hostname = url.hostname.toLowerCase()
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key)
    }
    return url.toString().replace(/\/$/, '')
  } catch {
    return raw.trim().toLowerCase()
  }
}

export function domainOf(raw: string): string {
  try { return new URL(raw).hostname.toLowerCase() } catch { return '' }
}

/** Build a normalized result; throws nothing, silently drops unusable rows. */
export function toSearchResult(provider: SearchResult['provider'], input: {
  title: string; url: string; snippet: string
  publishedAt?: string; author?: string; score?: number
}): SearchResult {
  return {
    title: input.title.slice(0, 300),
    url: input.url.slice(0, 2000),
    canonicalUrl: canonicalizeUrl(input.url),
    domain: domainOf(input.url),
    snippet: capText(input.snippet, 600),
    ...(input.publishedAt ? { publishedAt: input.publishedAt.slice(0, 40) } : {}),
    ...(input.author ? { author: input.author.slice(0, 120) } : {}),
    provider,
    ...(typeof input.score === 'number' && Number.isFinite(input.score) ? { score: input.score } : {}),
    retrievedAt: Date.now(),
  }
}

export function capText(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

export interface MergeOptions {
  /** Cap on total merged results. */
  maxResults: number
}

/**
 * Deduplicate by canonical URL, merge snippets from multiple providers and
 * rank: (1) cross-provider corroboration count, (2) provider relevance score
 * when present, (3) source diversity (same domain demoted after 2 hits).
 * Purely mechanical — no invented relevance.
 */
export function mergeAndRankResults(batches: SearchResult[][], options: MergeOptions): SearchResult[] {
  const byCanonical = new Map<string, SearchResult & { corroboratedBy: Set<string> }>()
  for (const batch of batches) {
    for (const result of batch) {
      const existing = byCanonical.get(result.canonicalUrl)
      if (existing) {
        existing.corroboratedBy.add(result.provider)
        // Keep the richer snippet (cross-provider corroboration improves it).
        if (result.snippet.length > existing.snippet.length) existing.snippet = result.snippet
        if (!existing.publishedAt && result.publishedAt) existing.publishedAt = result.publishedAt
        if (!existing.author && result.author) existing.author = result.author
      } else {
        byCanonical.set(result.canonicalUrl, { ...result, corroboratedBy: new Set([result.provider]) })
      }
    }
  }
  const domainCount = new Map<string, number>()
  const ranked = [...byCanonical.values()]
    .map(result => ({ result, corroboration: result.corroboratedBy.size }))
    .sort((a, b) => {
      if (b.corroboration !== a.corroboration) return b.corroboration - a.corroboration
      const scoreA = a.result.score ?? 0
      const scoreB = b.result.score ?? 0
      if (scoreB !== scoreA) return scoreB - scoreA
      return a.result.retrievedAt - b.result.retrievedAt
    })
    .map(({ result }) => {
      const seen = domainCount.get(result.domain) ?? 0
      domainCount.set(result.domain, seen + 1)
      return { result, domainRank: seen }
    })
  // Source diversity: after 2 results from one domain, push the rest to the tail.
  const primary: typeof ranked = []
  const overflow: typeof ranked = []
  for (const entry of ranked) (entry.domainRank < 2 ? primary : overflow).push(entry)
  return [...primary, ...overflow]
    .map(({ result }) => result)
    .slice(0, options.maxResults)
}

/** Render results as a compact citation list for prompts/UI. */
export function renderCitations(results: SearchResult[]): string {
  return results.map((result, index) =>
    `[${index + 1}] ${result.title} — ${result.url}${result.publishedAt ? ` (${result.publishedAt})` : ''} [via ${result.provider}]`
  ).join('\n')
}
