import { streamChat } from '@/lib/ai/router'
import { providerErrorMessage } from '@/lib/ai/errors'
import { PROVIDERS } from '@/lib/constants/models'
import { listProviderModels } from '@/lib/ai/provider-catalog'
import { generationWorksKeyless, modelOption, preferredModel } from '@/lib/ai/catalog'
import { readLimitedJson, rejectCrossOrigin, validateWorkspaceFileMap } from '@/lib/deploy/validate'
import type { AIMessage, ProviderType } from '@/types'
import { BudgetGovernanceManager } from '@/lib/foundations/budget-governance'
import { checkRateLimit, rateLimitedResponse, RATE_LIMITS } from '@/lib/security/rate-limit'
export const maxDuration = 300
export const runtime = 'nodejs'

export async function POST(request: Request) {
  if (rejectCrossOrigin(request)) return Response.json({ error: 'Cross-site requests are not allowed.' }, { status: 403 })
  const rate = await checkRateLimit(request, RATE_LIMITS.chat)
  if (!rate.ok) return rateLimitedResponse(rate)
  const parsed = await readLimitedJson(request, 1_000_000)
  if (parsed.ok === false) return Response.json({ error: parsed.error || 'Project context is too large. Keep requests under 1 MB.' }, { status: parsed.status })
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return Response.json({ error: 'Invalid request.' }, { status: 400 })
  const body = parsed.value as Record<string, unknown>
  if (!body || typeof body !== 'object') return Response.json({ error: 'Invalid request.' }, { status: 400 })
  const provider = body.provider as ProviderType
  if (!Object.hasOwn(PROVIDERS, provider)) return Response.json({ error: 'Select a supported cloud provider.' }, { status: 400 })
  const apiKey = request.headers.get('x-api-key')?.trim() ?? ''
  // Local runtimes (Ollama) answer without a credential; cloud providers keep the 401 guard.
  if ((!apiKey && !generationWorksKeyless(provider)) || (apiKey && apiKey.length > 4096)) return Response.json({ error: `Add your ${PROVIDERS[provider].name} key in Settings to start building.` }, { status: 401 })
  if (typeof body.model !== 'string' || !body.model.trim() || body.model.length > 150) return Response.json({ error: 'Select a valid model.' }, { status: 400 })
  const allowUnverifiedPricing = body.allowPaidModels === true
    || (typeof body.consentedModel === 'string' && body.consentedModel === `${provider}:${String(body.model)}`)
  const selectedTier = modelOption(provider, body.model).tier
  if (!allowUnverifiedPricing && selectedTier !== 'free' && selectedTier !== 'free-tier') {
    return Response.json({ error: `Biaya model ${body.model} belum dapat diverifikasi sebagai gratis dari metadata provider. Berikan persetujuan khusus untuk model ini di pemilih model hanya jika Anda memahami risiko billing.` }, { status: 402 })
  }
  if (!Array.isArray(body.messages) || !body.messages.length || body.messages.length > 100 || body.messages.some(message => !message || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string' || message.content.length > 100_000)) return Response.json({ error: 'Invalid conversation. Each message must be under 100,000 characters.' }, { status: 400 })
  const filesValidation = validateWorkspaceFileMap(body.files)
  if ('error' in filesValidation) return Response.json({ error: filesValidation.error }, { status: 400 })
  // Request-scoped estimate only; it cannot enforce provider-account or monthly billing limits.
  const budget = new BudgetGovernanceManager(4, 250_000)
  const estimatedInputTokens = Math.ceil((
    (body.messages as AIMessage[]).reduce((sum, message) => sum + message.content.length, 0) +
    Object.entries(body.files as Record<string, string>).reduce((sum, [path, content]) => sum + path.length + content.length, 0)
  ) / 4)
  try {
    budget.recordRequest(estimatedInputTokens + 16_384)
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Request exceeds the local token safety budget.' }, { status: 429 })
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: object) => controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'))
      try {
        const result = streamChat({ provider, apiKey, model: body.model as string, messages: body.messages as AIMessage[], files: body.files as Record<string, string>, signal: request.signal })
        for await (const part of result.fullStream) {
          if (part.type === 'error') throw part.error
          if (part.type === 'text-delta') send({ type: 'delta', text: part.text })
        }
        const reason = await result.finishReason
        if (reason === 'error' || reason === 'interrupted' || reason === 'length') {
          if (reason === 'error') budget.recordFailure('Provider stream finished with an error')
          send({ type: 'error', error: reason === 'length' ? 'Response reached the model output limit. Ask YUHA to continue.' : 'Stream interrupted. Your partial response has been kept.' })
        } else { budget.recordSuccess(); send({ type: 'done' }) }
      } catch (error) {
        budget.recordFailure(error instanceof Error ? error.message : 'Unknown streaming failure')
        let message = providerErrorMessage(error, provider, body.model as string)
        if (message.includes('model unavailable') && !request.signal.aborted) {
          try {
            const models = await listProviderModels(provider, apiKey, AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]))
            const recommended = preferredModel(models.filter(model => model.id !== body.model))
            if (recommended) message += ` Available alternative: ${recommended.id}. Select it explicitly; your model has not been changed.`
          } catch { /* Catalog access may differ from generation access; preserve the original provider error. */ }
        }
        if (!request.signal.aborted) send({ type: 'error', error: message })
      } finally { controller.close() }
    },
  })
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } })
}
