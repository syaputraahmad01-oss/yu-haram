/**
 * Central provider tier policy (Master Prompt 3.1).
 *
 * Single source of truth for "which provider's models default to which
 * pricing tier". One file to update when a provider changes its free-tier
 * terms — no scattered hardcoding.
 *
 * Honesty contract:
 *  - 'free-tier' means: the provider DOCUMENTS a free developer tier for its
 *    standard text models (rate-limited; per-account quota NOT visible to us).
 *  - It does NOT mean unlimited, and quota status is reported as unknown.
 *  - Models whose pricing metadata proves a price stay 'paid'; models without
 *    any evidence stay 'unknown' — never silently 'free'.
 *
 * Documented evidence (checked 2026-11-12):
 *  - Google Gemini API (AI Studio): free tier with per-model RPM/RPD limits —
 *    https://ai.google.dev/gemini-api/docs/rate-lists
 *  - Groq Cloud: free tier with per-model rate limits —
 *    https://console.groq.com/docs/rate-limits
 *  - Moonshot Kimi / Alibaba Qwen: no documented universal free tier → unknown.
 *  - OpenRouter: per-model pricing metadata (`:free` variants are free).
 *  - Ollama: local runtime → free by construction (self-hosted).
 */

import type { ProviderType } from '@/types'
import type { ModelTier } from './catalog'

export type QuotaVisibility = 'unknown' | 'local' | 'metadata'

export interface ProviderTierPolicy {
  /** Default tier for a provider's catalog models before pricing metadata. */
  defaultTier: ModelTier
  /** What we can honestly say about the account's remaining quota. */
  quotaVisibility: QuotaVisibility
  /** Honest user-facing note about limits; never promises unlimited use. */
  quotaNote: string
}

export const PROVIDER_TIER_POLICY: Record<ProviderType, ProviderTierPolicy> = {
  gemini: {
    defaultTier: 'free-tier',
    quotaVisibility: 'unknown',
    quotaNote: 'Gemini menyediakan kuota free-tier developer dengan batas RPM/RPD per model. Sisa kuota akun Anda tidak dapat dilihat dari sini dan bisa berubah sewaktu-waktu; melewati batas akan menghasilkan error 429.',
  },
  groq: {
    defaultTier: 'free-tier',
    quotaVisibility: 'unknown',
    quotaNote: 'Groq menyediakan kuota free-tier developer dengan batas RPM/TPD per model. Sisa kuota akun Anda tidak dapat dilihat dari sini; melewati batas akan menghasilkan error 429.',
  },
  openrouter: {
    defaultTier: 'unknown',
    quotaVisibility: 'metadata',
    quotaNote: 'OpenRouter menampilkan harga per model. Varian :free gratis dengan batas provider; model berbayar butuh persetujuan per model.',
  },
  ollama: {
    defaultTier: 'free',
    quotaVisibility: 'local',
    quotaNote: 'Model berjalan lokal di perangkat Anda (tanpa tagihan API hosted).',
  },
  kimi: {
    defaultTier: 'unknown',
    quotaVisibility: 'unknown',
    quotaNote: 'Ketersediaan kuota gratis Moonshot tidak dapat diverifikasi dari katalog; jangan diasumsikan gratis.',
  },
  qwen: {
    defaultTier: 'unknown',
    quotaVisibility: 'unknown',
    quotaNote: 'Ketersediaan kuota gratis DashScope tidak dapat diverifikasi dari katalog; jangan diasumsikan gratis.',
  },
}

/**
 * Resolve the tier for one model id from the provider policy, honouring
 * explicit free variants. Pricing metadata (when present) still overrides —
 * a listed price beats a policy default.
 */
export function tierForModel(provider: ProviderType, modelId: string): { tier: ModelTier; isFree: boolean } {
  const policy = PROVIDER_TIER_POLICY[provider]
  if (provider === 'openrouter' && modelId.endsWith(':free')) return { tier: 'free', isFree: true }
  return { tier: policy.defaultTier, isFree: policy.defaultTier === 'free' }
}
