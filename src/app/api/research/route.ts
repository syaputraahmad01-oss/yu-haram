import { readLimitedJson, rejectCrossOrigin } from '@/lib/deploy/validate'
import { checkRateLimit, rateLimitedResponse, RATE_LIMITS } from '@/lib/security/rate-limit'
import { searchWithFallback, extractContent } from '@/lib/research/router'
import { RESEARCH_PROVIDERS, type ResearchProviderId } from '@/lib/research/types'
import { frameUntrustedContent, detectInjectedInstructions } from '@/lib/research/security'
import { isForbiddenIp } from '@/lib/security/ssrf'

export const runtime = 'nodejs'
export const maxDuration = 60

const RESEARCH_PROVIDER_IDS = Object.keys(RESEARCH_PROVIDERS) as ResearchProviderId[]
const headers = { 'Cache-Control': 'no-store' }

function readCredential(request: Request, provider: ResearchProviderId): string {
  const key = request.headers.get(`x-yuha-research-key-${provider}`)?.trim() || ''
  return key.length <= 4096 ? key : ''
}

export async function POST(request: Request) {
  if (rejectCrossOrigin(request)) return Response.json({ error: 'Cross-site requests are not allowed.' }, { status: 403, headers })
  const rate = await checkRateLimit(request, RATE_LIMITS.research)
  if (!rate.ok) return rateLimitedResponse(rate)
  const parsed = await readLimitedJson(request, 8192)
  if (parsed.ok === false) return Response.json({ error: parsed.error }, { status: parsed.status, headers })
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return Response.json({ error: 'Invalid request.' }, { status: 400, headers })
  const body = parsed.value as Record<string, unknown>
  const action = body.action
  if (action === 'test') return handleTest(request, body)
  if (action === 'search') return handleSearch(request, body)
  if (action === 'extract') return handleExtract(request, body)
  return Response.json({ error: 'Unsupported action.' }, { status: 400, headers })
}

async function handleTest(request: Request, body: Record<string, unknown>) {
  const provider = body.provider as ResearchProviderId
  if (!RESEARCH_PROVIDER_IDS.includes(provider)) return Response.json({ error: 'Unknown research provider.' }, { status: 400, headers })
  const credential = readCredential(request, provider)
  const meta = RESEARCH_PROVIDERS[provider]
  if (meta.needsKey && !credential) return Response.json({ error: `Simpan API key ${meta.name} terlebih dahulu.` }, { status: 401, headers })
  try {
    const outcome = await searchWithFallback('open source', {
      order: [provider],
      credentials: { [provider]: credential },
      maxResults: 1,
      searxngBaseUrl: typeof body.searxngBaseUrl === 'string' ? body.searxngBaseUrl : undefined,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(25_000)]),
    })
    return Response.json({ status: 'success', sampleCount: outcome.results.length, checkedAt: Date.now() }, { headers })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Connection test failed.' }, { status: 502, headers })
  }
}

async function handleSearch(request: Request, body: Record<string, unknown>) {
  const query = typeof body.query === 'string' ? body.query.trim() : ''
  if (!query || query.length > 400) return Response.json({ error: 'Query penelitian 1-400 karakter.' }, { status: 400, headers })
  if (!Array.isArray(body.order) || !body.order.length || body.order.length > 7) return Response.json({ error: 'Urutan provider tidak valid.' }, { status: 400, headers })
  const order = [...new Set(body.order.filter((entry): entry is ResearchProviderId =>
    typeof entry === 'string' && RESEARCH_PROVIDER_IDS.includes(entry as ResearchProviderId)))]
  if (!order.length) return Response.json({ error: 'Tidak ada provider riset yang valid.' }, { status: 400, headers })
  const maxResults = typeof body.maxResults === 'number' && Number.isInteger(body.maxResults) ? Math.min(Math.max(body.maxResults, 1), 10) : 5
  const credentials = Object.fromEntries(RESEARCH_PROVIDER_IDS.map(provider => [provider, readCredential(request, provider)])) as Partial<Record<ResearchProviderId, string>>
  const searxngBaseUrl = typeof body.searxngBaseUrl === 'string' && /^https?:\/\//.test(body.searxngBaseUrl) ? body.searxngBaseUrl.slice(0, 300) : undefined

  const outcome = await searchWithFallback(query, {
    order, credentials, maxResults, searxngBaseUrl,
    signal: AbortSignal.any([request.signal, AbortSignal.timeout(45_000)]),
  })
  return Response.json({
    results: outcome.results,
    usedProviders: outcome.usedProviders,
    failures: outcome.failures.map(failure => ({ provider: failure.provider, kind: failure.kind, detail: failure.detail })),
    query, checkedAt: Date.now(),
  }, { headers })
}

async function handleExtract(request: Request, body: Record<string, unknown>) {
  const url = typeof body.url === 'string' ? body.url.trim() : ''
  if (!url || url.length > 2000) return Response.json({ error: 'URL ekstraksi tidak valid.' }, { status: 400, headers })
  let target: URL
  try { target = new URL(url) } catch { return Response.json({ error: 'URL tidak valid.' }, { status: 400, headers }) }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return Response.json({ error: 'Hanya http(s) diizinkan.' }, { status: 400, headers })
  // Direct literal-IP targets never reach the web at all.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(target.hostname) && isForbiddenIp(target.hostname)) {
    return Response.json({ error: 'Alamat IP target ditolak.' }, { status: 400, headers })
  }
  const credential = readCredential(request, 'firecrawl')
  if (!credential) return Response.json({ error: 'Simpan API key Firecrawl terlebih dahulu.' }, { status: 401, headers })
  try {
    const extracted = await extractContent(url, credential, AbortSignal.any([request.signal, AbortSignal.timeout(45_000)]))
    const warnings = detectInjectedInstructions(extracted.content)
    // The extracted content is returned already framed: downstream prompts
    // can embed it without re-framing (Master 9.7 prompt-injection defense).
    return Response.json({
      url: extracted.url, title: extracted.title,
      framedContent: frameUntrustedContent(extracted.url, extracted.content),
      contentLength: extracted.content.length,
      ...(warnings.length ? { securityWarnings: warnings } : {}),
      checkedAt: extracted.retrievedAt,
    }, { headers })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Ekstraksi konten gagal.' }, { status: 502, headers })
  }
}
