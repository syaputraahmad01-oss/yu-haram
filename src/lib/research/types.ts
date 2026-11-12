/**
 * Web Research Engine — shared types (Master Prompt section 9).
 *
 * Every adapter normalizes to SearchResult; Firecrawl is a CONTENT
 * EXTRACTION provider (used after URLs are known), not a search engine —
 * the types make that distinction explicit so no adapter is misused.
 */

export type ResearchProviderId =
  | 'tavily'
  | 'serpapi'
  | 'searxng'
  | 'duckduckgo'
  | 'brave'
  | 'exa'
  | 'firecrawl'

export interface SearchResult {
  title: string
  url: string
  /** Canonical dedup key (lowercased, no tracking params). */
  canonicalUrl: string
  domain: string
  snippet: string
  /** Only when the provider actually reports it — never fabricated. */
  publishedAt?: string
  author?: string
  provider: ResearchProviderId
  /** Provider relevance score when available; never invented. */
  score?: number
  retrievedAt: number
}

export interface ExtractedContent {
  url: string
  title: string
  /** Plain text / markdown extracted from the page (untrusted data). */
  content: string
  provider: 'firecrawl'
  retrievedAt: number
}

export interface ResearchProviderMeta {
  id: ResearchProviderId
  name: string
  /** What this provider genuinely does — honest capability labels. */
  role: 'search' | 'extraction'
  needsKey: boolean
  /** User-configurable endpoint (SearXNG self-host). */
  configurableEndpoint: boolean
  capabilityNote: string
  docsUrl: string
}

export const RESEARCH_PROVIDERS: Record<ResearchProviderId, ResearchProviderMeta> = {
  tavily: {
    id: 'tavily', name: 'Tavily', role: 'search', needsKey: true, configurableEndpoint: false,
    capabilityNote: 'Pencarian web berorientasi AI: hasil relevan + konteks ringkas untuk riset.',
    docsUrl: 'https://docs.tavily.com',
  },
  serpapi: {
    id: 'serpapi', name: 'SerpAPI', role: 'search', needsKey: true, configurableEndpoint: false,
    capabilityNote: 'Hasil SERP terstruktur (Google dst. sesuai akun); cocok untuk hasil mesin pencari.',
    docsUrl: 'https://serpapi.com/manage-api-key',
  },
  searxng: {
    id: 'searxng', name: 'SearXNG', role: 'search', needsKey: false, configurableEndpoint: true,
    capabilityNote: 'Metasearch self-hosted lintas mesin pencari; Anda mengatur base URL instance sendiri.',
    docsUrl: 'https://docs.searxng.org',
  },
  duckduckgo: {
    id: 'duckduckgo', name: 'DuckDuckGo', role: 'search', needsKey: false, configurableEndpoint: false,
    capabilityNote: 'Instant Answer API resmi (api.duckduckgo.com) — HANYA jawaban instan/tema terkait, BUKAN halaman hasil pencarian penuh. Bisa dinonaktifkan.',
    docsUrl: 'https://duckduckgo.com/duckduckgo-help-pages/results/duckduckgo-api',
  },
  brave: {
    id: 'brave', name: 'Brave Search', role: 'search', needsKey: true, configurableEndpoint: false,
    capabilityNote: 'Web Search API resmi Brave (sesuai jenis akun/paket).',
    docsUrl: 'https://brave.com/search/api/',
  },
  exa: {
    id: 'exa', name: 'Exa', role: 'search', needsKey: true, configurableEndpoint: false,
    capabilityNote: 'Pencarian semantik/neural: menemukan halaman mirip secara makna, kuat untuk discovery riset.',
    docsUrl: 'https://docs.exa.ai',
  },
  firecrawl: {
    id: 'firecrawl', name: 'Firecrawl', role: 'extraction', needsKey: true, configurableEndpoint: false,
    capabilityNote: 'Crawling + ekstraksi konten halaman menjadi markdown siap LLM. Bukan mesin pencari — dipakai SETELAH URL relevan ditemukan.',
    docsUrl: 'https://docs.firecrawl.dev',
  },
}

export interface SearchAdapter {
  meta: ResearchProviderMeta
  /** maxResults is a hard cap; adapters never return more. */
  search(query: string, credential: string, options: SearchOptions): Promise<SearchResult[]>
}

export interface SearchOptions {
  maxResults: number
  /** SearXNG instance base URL (validated http(s), no credentials in URL). */
  searxngBaseUrl?: string
  signal?: AbortSignal
}

export interface ExtractAdapter {
  meta: ResearchProviderMeta
  extract(url: string, credential: string, signal?: AbortSignal): Promise<ExtractedContent>
}

/** Research failure classification — distinct causes, never conflated. */
export type ResearchFailureKind =
  | 'auth'          // invalid key (401/403)
  | 'quota'         // 402 / plan limit
  | 'rate_limit'    // 429
  | 'network'       // DNS/connect/TLS
  | 'timeout'
  | 'provider_error' // 5xx
  | 'invalid_response'
  | 'blocked'       // request rejected by policy (SSRF etc.)

export interface ResearchFailure {
  provider: ResearchProviderId
  kind: ResearchFailureKind
  detail: string
}
