import type { ProviderType } from '@/types'
import { tierForModel } from './provider-tiers'

export type ModelTier = 'free' | 'free-tier' | 'paid' | 'unknown'

export interface ModelPricing {
  prompt?: string
  completion?: string
  request?: string
}

export interface ModelOption {
  id: string
  name: string
  provider?: ProviderType
  tier: ModelTier
  isFree?: boolean
  recommended?: string
  outputTokenLimit?: number
  contextWindow?: number
  pricing?: ModelPricing
  description?: string
}

export const TIER_LABELS: Record<ModelTier, string> = {
  free: 'GRATIS',
  'free-tier': 'GRATIS (Kuota Free-Tier)',
  paid: 'BERBAYAR',
  unknown: 'Biaya Belum Diverifikasi',
}

export function formatModelPricing(model: ModelOption): string {
  if (model.tier === 'free') {
    if (model.provider === 'ollama') return 'Model lokal; tidak ada tagihan API hosted (biaya perangkat/listrik tetap berlaku)'
    return 'Gratis melalui varian :free (tetap tunduk pada batas provider)'
  }
  if (model.tier === 'free-tier') return 'Gratis (Sesuai kuota pengembang)'
  if (model.pricing?.prompt != null && model.pricing?.completion != null) {
    const rawPrompt = Number(model.pricing.prompt)
    const rawCompletion = Number(model.pricing.completion)
    const promptNum = rawPrompt * 1_000_000
    const compNum = rawCompletion * 1_000_000
    if (Number.isFinite(promptNum) && Number.isFinite(compNum) && (promptNum > 0 || compNum > 0)) {
      return `$${promptNum.toFixed(2)}/1M in · $${compNum.toFixed(2)}/1M out`
    }
    if (rawPrompt === 0 && rawCompletion === 0) {
      return 'Harga model tercantum $0; kelayakan akun dan batas akses belum diverifikasi'
    }
  }
  if (model.tier === 'paid') return 'Berbayar (Cek tarif provider)'
  return 'Biaya belum diverifikasi (jangan diasumsikan gratis)'
}

export function modelOption(provider: ProviderType, id: string): ModelOption {
  // Tier comes from the central provider policy (provider-tiers.ts): providers
  // with a DOCUMENTED free developer tier default to 'free-tier' (quota status
  // honestly reported as unknown), others stay 'unknown' until pricing
  // metadata proves otherwise. Never assume free from a model-name family.
  const { tier, isFree } = tierForModel(provider, id)
  let recommended: string | undefined
  if (provider === 'openrouter' && tier === 'free') recommended = 'OpenRouter Free Model'
  if (provider === 'ollama') recommended = 'Ollama lokal (tanpa tagihan API hosted)'

  return { id, name: id, provider, tier, isFree, recommended }
}

export function fallbackModels(_provider: ProviderType): ModelOption[] { return [] }

/** Providers whose model catalog can be listed without an API key. */
export function catalogListsKeyless(provider: ProviderType): boolean {
  return provider === 'openrouter' || provider === 'ollama'
}

/** Providers that can answer generation requests without an API key (local runtimes). */
export function generationWorksKeyless(provider: ProviderType): boolean {
  return provider === 'ollama'
}

/** Return only genuinely free or free-tier models. Never returns paid models. */
export function preferredFreeModel(models: ModelOption[]): ModelOption | null {
  return models.find(model => model.tier === 'free')
    || models.find(model => model.tier === 'free-tier')
    || null
}

/** Standard preferred model: prioritizes 100% free, then free-tier. Strictly respects allowPaid. */
export function preferredModel(models: ModelOption[], allowPaid = false): ModelOption | undefined {
  const free = preferredFreeModel(models)
  if (free) return free
  if (allowPaid) return models[0]
  // Bug 5 fix: NEVER fall back to a paid model when allowPaid is false!
  return undefined
}

export function modelLabel(model: ModelOption): string {
  const badge = TIER_LABELS[model.tier] || 'Biaya Belum Diverifikasi'
  const rec = model.recommended ? ' · Rekomendasi' : ''
  const limit = model.contextWindow ? ` · ${(model.contextWindow / 1000).toFixed(0)}k ctx` : ''
  return `${model.name} · [${badge}]${rec}${limit}`
}

/**
 * Compact, human-friendly display name for a model id.
 * "google/gemini-2.0-flash-exp:free" → "gemini-2.0-flash-exp".
 * Vendor prefixes and the free-variant suffix are provenance metadata, not
 * something the user needs to read while picking a model.
 */
export function shortModelName(id: string): string {
  let name = id
  const slash = name.lastIndexOf('/')
  if (slash >= 0) name = name.slice(slash + 1)
  if (name.endsWith(':free')) name = name.slice(0, -':free'.length)
  return name || id
}

type Entry = Record<string, unknown>
function entries(value: unknown): Entry[] {
  return Array.isArray(value) ? value.filter((entry): entry is Entry => !!entry && typeof entry === 'object') : []
}

export function normalizeCatalog(provider: ProviderType, payload: Entry): ModelOption[] {
  const list = entries(provider === 'gemini' ? payload.models : payload.data)
  const models: ModelOption[] = []

  for (const item of list) {
    const rawId = provider === 'gemini' ? item.name : item.id
    if (typeof rawId !== 'string') continue
    const id = rawId.replace(/^models\//, '')
    if (!id || id.length > 150 || !/^[\w./:@-]+$/.test(id)) continue

    if (provider === 'gemini' && (!Array.isArray(item.supportedGenerationMethods) || !item.supportedGenerationMethods.includes('generateContent'))) continue
    if (/embedding|rerank|whisper|guard|orpheus|tts|image|video|audio|live|transcri|omni|veo|wan\d|nano-banana/i.test(id)) continue
    if (item.active === false || /:batch(?:$|:)/.test(id)) continue
    if (Array.isArray(item.endpoints) && !item.endpoints.some(endpoint => typeof endpoint === 'string' && endpoint.endsWith('/chat/completions'))) continue
    
    const architecture = item.architecture as { output_modalities?: string[] } | undefined
    if (architecture?.output_modalities && !architecture.output_modalities.includes('text')) continue

    const model = modelOption(provider, id)

    // Capture pricing if provided
    const pricing = item.pricing as { prompt?: string; completion?: string; request?: string } | undefined
    if (pricing && typeof pricing === 'object') {
      model.pricing = {
        prompt: pricing.prompt != null ? String(pricing.prompt) : undefined,
        completion: pricing.completion != null ? String(pricing.completion) : undefined,
        request: pricing.request != null ? String(pricing.request) : undefined,
      }
    }

    // Pricing metadata only reclassifies paid cloud gateways. A local runtime
    // (Ollama) is free by construction — even when an OpenAI-compatible shim
    // reports $0 pricing metadata — so it keeps its 'free' tier.
    if (pricing?.prompt != null && pricing?.completion != null && !generationWorksKeyless(provider)) {
      const promptPrice = Number(pricing.prompt)
      const completionPrice = Number(pricing.completion)
      const requestPrice = pricing.request == null ? 0 : Number(pricing.request)
      const validPrices = [promptPrice, completionPrice, requestPrice].every(Number.isFinite)
      if (id.endsWith(':free')) {
        model.tier = 'free'
        model.isFree = true
      } else if (validPrices && (promptPrice > 0 || completionPrice > 0 || requestPrice > 0)) {
        model.tier = 'paid'
        model.isFree = false
      } else if (validPrices && promptPrice === 0 && completionPrice === 0 && requestPrice === 0) {
        // Some $0 OpenRouter models still require a funded account; do not auto-route.
        model.tier = 'unknown'
        model.isFree = false
      }
    }

    // Capture context length / token limits
    if (typeof item.context_length === 'number') {
      model.contextWindow = item.context_length
    } else if (typeof item.inputTokenLimit === 'number') {
      model.contextWindow = item.inputTokenLimit
    } else if (typeof item.context_window === 'number') {
      model.contextWindow = item.context_window
    }

    if (typeof item.displayName === 'string') model.name = item.displayName.slice(0, 150)
    if (typeof item.description === 'string') model.description = item.description.slice(0, 300)
    if (typeof item.outputTokenLimit === 'number') model.outputTokenLimit = item.outputTokenLimit

    models.push(model)
  }

  // Deduplicate and sort FREE-FIRST strictly:
  // 1. 'free' (0)
  // 2. 'free-tier' (1)
  // 3. 'unknown' (2)
  // 4. 'paid' (3)
  const tierWeight: Record<ModelTier, number> = {
    'free': 0,
    'free-tier': 1,
    'unknown': 2,
    'paid': 3,
  }

  return [...new Map(models.map(model => [model.id, model])).values()]
    .sort((a, b) => {
      const weightDiff = (tierWeight[a.tier] ?? 2) - (tierWeight[b.tier] ?? 2)
      if (weightDiff !== 0) return weightDiff
      return a.id.localeCompare(b.id, undefined, { numeric: true })
    })
    .slice(0, 1000)
}
