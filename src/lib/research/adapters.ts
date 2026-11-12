/**
 * Provider adapters for the Web Research Engine.
 *
 * Honest capability mapping (Master Prompt 9.2):
 *  - SEARCH: tavily, serpapi, searxng, duckduckgo (instant answers only), brave, exa
 *  - EXTRACTION: firecrawl (crawls a KNOWN url — never used as a search engine)
 *
 * All requests go through guardedFetch (SSRF + DNS-rebinding pinning) with a
 * hard timeout and a response-size cap. Redirects are rejected by default.
 * DuckDuckGo uses the OFFICIAL Instant Answer JSON API — it is NOT full web
 * search, and its adapter says so.
 */

import { guardedFetch } from '@/lib/security/ssrf'
import { canonicalizeUrl, toSearchResult, capText } from './normalize'
import type { ExtractAdapter, ResearchProviderId, SearchAdapter, SearchResult, ResearchFailureKind } from './types'

const REQUEST_TIMEOUT_MS = 20_000
const MAX_RESPONSE_BYTES = 2_000_000

export class ResearchError extends Error {
  constructor(public readonly kind: ResearchFailureKind, message: string) {
    super(message)
  }
}

function kindFromStatus(status: number): ResearchFailureKind {
  if (status === 401 || status === 403) return 'auth'
  if (status === 402) return 'quota'
  if (status === 429) return 'rate_limit'
  if (status >= 500) return 'provider_error'
  return 'invalid_response'
}

async function researchFetch(url: string | URL, init: Parameters<typeof guardedFetch>[1] = {}): Promise<unknown> {
  const response = await guardedFetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  if (!response.ok) throw new ResearchError(kindFromStatus(response.status), `HTTP ${response.status} dari ${typeof url === 'string' ? url : url.hostname}`)
  const text = await response.text()
  if (text.length > MAX_RESPONSE_BYTES) throw new ResearchError('invalid_response', 'Respons provider melebihi batas ukuran.')
  try { return JSON.parse(text) } catch { throw new ResearchError('invalid_response', 'Respons provider bukan JSON valid.') }
}

function firstString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/* ------------------------------ Tavily ------------------------------ */

export const tavilyAdapter: SearchAdapter = {
  meta: { id: 'tavily', name: 'Tavily', role: 'search', needsKey: true, configurableEndpoint: false, capabilityNote: 'AI-oriented web search', docsUrl: 'https://docs.tavily.com' },
  async search(query, credential, options) {
    if (!credential) throw new ResearchError('auth', 'Tavily membutuhkan API key.')
    const payload = await researchFetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credential}` },
      body: JSON.stringify({ query, max_results: Math.min(options.maxResults, 20), search_depth: 'basic' }),
      signal: options.signal,
    }) as { results?: Array<{ title?: unknown; url?: unknown; content?: unknown; score?: unknown }> }
    return (payload.results ?? [])
      .map(entry => toSearchResult('tavily', {
        title: firstString(entry.title) ?? '',
        url: firstString(entry.url) ?? '',
        snippet: firstString(entry.content) ?? '',
        score: typeof entry.score === 'number' ? entry.score : undefined,
      }))
      .filter(result => result.url)
      .slice(0, options.maxResults)
  },
}

/* ------------------------------ SerpAPI ------------------------------ */

export const serpApiAdapter: SearchAdapter = {
  meta: { id: 'serpapi', name: 'SerpAPI', role: 'search', needsKey: true, configurableEndpoint: false, capabilityNote: 'Structured SERP results', docsUrl: 'https://serpapi.com' },
  async search(query, credential, options) {
    if (!credential) throw new ResearchError('auth', 'SerpAPI membutuhkan API key.')
    const url = new URL('https://serpapi.com/search.json')
    url.searchParams.set('api_key', credential)
    url.searchParams.set('q', query)
    url.searchParams.set('num', String(Math.min(options.maxResults, 20)))
    const payload = await researchFetch(url, { signal: options.signal }) as { organic_results?: Array<{ title?: unknown; link?: unknown; snippet?: unknown; date?: unknown }> }
    return (payload.organic_results ?? [])
      .map(entry => toSearchResult('serpapi', {
        title: firstString(entry.title) ?? '',
        url: firstString(entry.link) ?? '',
        snippet: firstString(entry.snippet) ?? '',
        publishedAt: firstString(entry.date),
      }))
      .filter(result => result.url)
      .slice(0, options.maxResults)
  },
}

/* ------------------------------ SearXNG ------------------------------ */

export const searxngAdapter: SearchAdapter = {
  meta: { id: 'searxng', name: 'SearXNG', role: 'search', needsKey: false, configurableEndpoint: true, capabilityNote: 'Self-hosted metasearch', docsUrl: 'https://docs.searxng.org' },
  async search(query, _credential, options) {
    const base = options.searxngBaseUrl?.trim()
    if (!base) throw new ResearchError('blocked', 'Base URL instance SearXNG belum dikonfigurasi.')
    let parsed: URL
    try { parsed = new URL(base) } catch { throw new ResearchError('blocked', 'Base URL SearXNG tidak valid.') }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new ResearchError('blocked', 'Skema SearXNG harus http(s).')
    if (parsed.username || parsed.password) throw new ResearchError('blocked', 'Kredensial tidak boleh berada di URL SearXNG.')
    const url = new URL('search', parsed)
    url.searchParams.set('q', query)
    url.searchParams.set('format', 'json')
    const payload = await researchFetch(url, { signal: options.signal }) as { results?: Array<{ title?: unknown; url?: unknown; content?: unknown; publishedDate?: unknown }> }
    return (payload.results ?? [])
      .map(entry => toSearchResult('searxng', {
        title: firstString(entry.title) ?? '',
        url: firstString(entry.url) ?? '',
        snippet: firstString(entry.content) ?? '',
        publishedAt: firstString(entry.publishedDate),
      }))
      .filter(result => result.url)
      .slice(0, options.maxResults)
  },
}

/* --------------------------- DuckDuckGo (IA) --------------------------- */

export const duckduckgoAdapter: SearchAdapter = {
  meta: { id: 'duckduckgo', name: 'DuckDuckGo', role: 'search', needsKey: false, configurableEndpoint: false, capabilityNote: 'Instant Answer API resmi — bukan SERP penuh', docsUrl: 'https://duckduckgo.com/duckduckgo-help-pages/results/duckduckgo-api' },
  async search(query, _credential, options) {
    // OFFICIAL Instant Answer API. Honest limitation: returns instant answers
    // and related topics, NOT a full search-engine result page.
    const url = new URL('https://api.duckduckgo.com/')
    url.searchParams.set('q', query)
    url.searchParams.set('format', 'json')
    url.searchParams.set('no_html', '1')
    url.searchParams.set('no_redirect', '1')
    url.searchParams.set('skip_disambig', '1')
    const payload = await researchFetch(url, { signal: options.signal }) as {
      AbstractText?: unknown; AbstractURL?: unknown; Heading?: unknown
      RelatedTopics?: Array<{ FirstURL?: unknown; Text?: unknown; Topics?: Array<{ FirstURL?: unknown; Text?: unknown }> }>
    }
    const results: SearchResult[] = []
    if (firstString(payload.AbstractURL) && firstString(payload.AbstractText)) {
      results.push(toSearchResult('duckduckgo', {
        title: firstString(payload.Heading) ?? 'DuckDuckGo Instant Answer',
        url: firstString(payload.AbstractURL) ?? '',
        snippet: firstString(payload.AbstractText) ?? '',
      }))
    }
    for (const topic of payload.RelatedTopics ?? []) {
      if (results.length >= options.maxResults) break
      const nested = Array.isArray((topic as { Topics?: unknown }).Topics) ? (topic as { Topics: Array<{ FirstURL?: unknown; Text?: unknown }> }).Topics : [topic as { FirstURL?: unknown; Text?: unknown }]
      for (const entry of nested) {
        if (results.length >= options.maxResults) break
        const link = firstString(entry.FirstURL)
        const text = firstString(entry.Text)
        if (link && text) results.push(toSearchResult('duckduckgo', { title: text.split(' - ')[0] ?? text, url: link, snippet: text }))
      }
    }
    return results.slice(0, options.maxResults)
  },
}

/* ---------------------------- Brave Search ---------------------------- */

export const braveAdapter: SearchAdapter = {
  meta: { id: 'brave', name: 'Brave Search', role: 'search', needsKey: true, configurableEndpoint: false, capabilityNote: 'Official Brave Web Search API', docsUrl: 'https://brave.com/search/api/' },
  async search(query, credential, options) {
    if (!credential) throw new ResearchError('auth', 'Brave Search membutuhkan API key.')
    const url = new URL('https://api.search.brave.com/res/v1/web/search')
    url.searchParams.set('q', query)
    url.searchParams.set('count', String(Math.min(options.maxResults, 20)))
    const payload = await researchFetch(url, {
      headers: { Accept: 'application/json', 'X-Subscription-Token': credential },
      signal: options.signal,
    }) as { web?: { results?: Array<{ title?: unknown; url?: unknown; description?: unknown; age?: unknown }> } }
    return (payload.web?.results ?? [])
      .map(entry => toSearchResult('brave', {
        title: firstString(entry.title) ?? '',
        url: firstString(entry.url) ?? '',
        snippet: firstString(entry.description) ?? '',
        publishedAt: firstString(entry.age),
      }))
      .filter(result => result.url)
      .slice(0, options.maxResults)
  },
}

/* -------------------------------- Exa -------------------------------- */

export const exaAdapter: SearchAdapter = {
  meta: { id: 'exa', name: 'Exa', role: 'search', needsKey: true, configurableEndpoint: false, capabilityNote: 'Semantic/neural search', docsUrl: 'https://docs.exa.ai' },
  async search(query, credential, options) {
    if (!credential) throw new ResearchError('auth', 'Exa membutuhkan API key.')
    const payload = await researchFetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': credential },
      body: JSON.stringify({ query, numResults: Math.min(options.maxResults, 20), type: 'auto' }),
      signal: options.signal,
    }) as { results?: Array<{ title?: unknown; url?: unknown; text?: unknown; publishedDate?: unknown; author?: unknown }> }
    return (payload.results ?? [])
      .map(entry => toSearchResult('exa', {
        title: firstString(entry.title) ?? '',
        url: firstString(entry.url) ?? '',
        snippet: capText(firstString(entry.text) ?? '', 500),
        publishedAt: firstString(entry.publishedDate),
        author: firstString(entry.author),
      }))
      .filter(result => result.url)
      .slice(0, options.maxResults)
  },
}

/* ------------------------------ Firecrawl ------------------------------ */

export const firecrawlAdapter: ExtractAdapter = {
  meta: { id: 'firecrawl', name: 'Firecrawl', role: 'extraction', needsKey: true, configurableEndpoint: false, capabilityNote: 'Crawl + extract page content as markdown', docsUrl: 'https://docs.firecrawl.dev' },
  async extract(url, credential, signal) {
    if (!credential) throw new ResearchError('auth', 'Firecrawl membutuhkan API key.')
    // The TARGET url is validated by guardedFetch server-side; also validate
    // the scheme here so a javascript:/file: url is rejected before any call.
    const target = new URL(url)
    if (target.protocol !== 'http:' && target.protocol !== 'https:') throw new ResearchError('blocked', 'URL target harus http(s).')
    const payload = await researchFetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credential}` },
      body: JSON.stringify({ url, formats: ['markdown'] }),
      signal,
    }) as { data?: { markdown?: unknown; metadata?: { title?: unknown; sourceURL?: unknown; description?: unknown } } }
    const content = firstString(payload.data?.markdown)
    if (!content) throw new ResearchError('invalid_response', 'Firecrawl tidak mengembalikan konten.')
    return {
      url: firstString(payload.data?.metadata?.sourceURL) ?? url,
      title: firstString(payload.data?.metadata?.title) ?? new URL(url).hostname,
      content: capText(content, 20_000),
      provider: 'firecrawl',
      retrievedAt: Date.now(),
    }
  },
}

/** Search-capable adapters keyed by provider id. Firecrawl is EXTRACTION-only
 *  (no entry here) — the router skips any ordered provider id without a
 *  search adapter, so the lookup is intentionally `Partial`. */
export const SEARCH_ADAPTERS: Partial<Record<ResearchProviderId, SearchAdapter>> = { tavily: tavilyAdapter, serpapi: serpApiAdapter, searxng: searxngAdapter, duckduckgo: duckduckgoAdapter, brave: braveAdapter, exa: exaAdapter }
export { canonicalizeUrl }
