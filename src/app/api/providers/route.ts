import { generateText } from 'ai'
import { getClient } from '@/lib/ai/router'
import { providerErrorMessage } from '@/lib/ai/errors'
import { listProviderModels } from '@/lib/ai/provider-catalog'
import { catalogListsKeyless, generationWorksKeyless } from '@/lib/ai/catalog'
import { PROVIDERS } from '@/lib/constants/models'
import { readLimitedJson, rejectCrossOrigin } from '@/lib/deploy/validate'
import { checkRateLimit, rateLimitedResponse, RATE_LIMITS } from '@/lib/security/rate-limit'
import type { ProviderType } from '@/types'

export const runtime = 'nodejs'
export const maxDuration = 60
const headers = { 'Cache-Control': 'no-store' }
export async function POST(request: Request) {
  if (rejectCrossOrigin(request)) return Response.json({ error: 'Cross-site requests are not allowed.' }, { status: 403, headers })
  const parsed = await readLimitedJson(request, 4096)
  if (parsed.ok === false) return Response.json({ error: parsed.error }, { status: parsed.status, headers })
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return Response.json({ error: 'Invalid request.' }, { status: 400, headers })
  const body = parsed.value as Record<string, unknown>
  if (!body || typeof body !== 'object') return Response.json({ error: 'Invalid request.' }, { status: 400, headers })
  const provider = body.provider as ProviderType
  if (!Object.hasOwn(PROVIDERS, provider) || !['list', 'test'].includes(String(body.action))) return Response.json({ error: 'Unsupported provider or action.' }, { status: 400, headers })
  // Connection tests spawn real provider generations and are limited more
  // aggressively than catalog listings.
  const rate = await checkRateLimit(request, body.action === 'test' ? RATE_LIMITS.providersTest : RATE_LIMITS.providersList)
  if (!rate.ok) return rateLimitedResponse(rate)
  const key = request.headers.get('x-api-key')?.trim() || ''
  // OpenRouter exposes a public catalog; Ollama is a local daemon that needs
  // no credential at all. Every other provider requires a key for both actions.
  const keyless = body.action === 'list'
    ? catalogListsKeyless(provider)
    : generationWorksKeyless(provider)
  if ((!key && !keyless) || key.length > 4096) return Response.json({ error: `Tambahkan API key ${PROVIDERS[provider].name} terlebih dahulu.` }, { status: 401, headers })
  const model = typeof body.model === 'string' ? body.model : ''
  if (body.action === 'test' && (!model || model.length > 150 || !/^[\w./:@-]+$/.test(model))) return Response.json({ error: 'Select a valid model.' }, { status: 400, headers })
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(body.action === 'test' ? 45_000 : 20_000)])
  const start = Date.now()
  try {
    if (body.action === 'list') return Response.json({ models: await listProviderModels(provider, key, signal), checkedAt: Date.now() }, { headers })
    const result = await generateText({ model: getClient(provider, key, model), prompt: 'Reply with only OK.', maxOutputTokens: 4096, maxRetries: 0, abortSignal: signal, telemetry: { isEnabled: false } })
    if (!result.text.trim()) return Response.json({ error: 'Provider menerima permintaan, tetapi model tidak mengembalikan teks. Coba model lain.' }, { status: 502, headers })
    return Response.json({ status: 'success', latency: Date.now() - start, checkedAt: Date.now() }, { headers })
  } catch (error) {
    return Response.json({ error: signal.aborted ? 'Tes melewati batas waktu atau dibatalkan. Coba kembali.' : providerErrorMessage(error, provider, model || 'catalog') }, { status: 502, headers })
  }
}
