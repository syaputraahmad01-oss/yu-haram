'use client'
/**
 * Shared Free-First cost-consent flow for model selection.
 *
 * Master Prompt 3.1.9: consent applies PER MODEL, not via a global switch.
 * A paid or pricing-unverified model may only become active after the user
 * explicitly consents to THAT model; the consent is persisted so it is asked
 * once per model (revocable from Settings).
 */
import { toast } from 'sonner'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import type { ModelOption } from '@/lib/ai/catalog'
import type { ProviderType } from '@/types'

export function isVerifiedFreeModel(model: ModelOption): boolean {
  return model.tier === 'free' || model.tier === 'free-tier'
}

export function isModelConsented(provider: ProviderType, modelId: string): boolean {
  return useSettingsStore.getState().consentedModels.includes(`${provider}:${modelId}`)
}

/**
 * Returns true when the model was (or already had been) consented and the
 * caller should proceed with selection. Returns false when the user has not
 * acted yet — the toast stays open and nothing is selected.
 */
export function confirmModelCost(
  model: ModelOption,
  provider: ProviderType,
  proceed: () => void,
): boolean {
  if (isVerifiedFreeModel(model) || isModelConsented(provider, model.id)) {
    proceed()
    return true
  }

  const costNote = model.tier === 'paid' ? 'diketahui berbayar' : 'belum terverifikasi biayanya'
  toast.warning(
    `Model ${model.id} ${costNote}. Berikan persetujuan khusus untuk model ini jika Anda memahami risiko billing.`,
    {
      duration: 8000,
      action: {
        label: 'Setujui model ini',
        onClick: () => {
          useSettingsStore.getState().consentModel(provider, model.id)
          proceed()
          toast.warning(`Persetujuan dicatat untuk ${model.id} saja. Periksa billing provider Anda; persetujuan dapat dicabut di Settings.`)
        },
      },
    },
  )
  return false
}
