'use client'
import useSWR from 'swr'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { catalogListsKeyless, fallbackModels, type ModelOption } from '@/lib/ai/catalog'
import { fetchCatalogDirect, combineCatalogErrors } from '@/lib/ai/catalog-direct'
import type { ProviderType } from '@/types'

export interface ModelCatalog { models: ModelOption[]; checkedAt: number; via?: 'server' | 'browser' }
export function useModelCatalog(provider: ProviderType) {
  const credential = useSettingsStore(state => state.apiKeys[provider] || '')
  const keyless = catalogListsKeyless(provider)
  const enabled = !!credential || keyless
  const swr = useSWR<ModelCatalog>(enabled ? ['model-catalog', provider, credential] : null, async () => {
    // Primary path: server-side fetch (SSRF-guarded, provider-uniform).
    let serverError: unknown
    try {
      const response = await fetch('/api/providers', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': credential },
        body: JSON.stringify({ provider, action: 'list' }), signal: AbortSignal.timeout(25_000),
      })
      const payload = await response.json()
      if (response.ok) return payload as ModelCatalog
      serverError = new Error(payload.error || 'Gagal mengambil katalog model.')
    } catch (error) {
      serverError = error
    }
    // Fallback path: the same request issued directly by the browser. This is
    // the only working path when the server egress sits in a region the
    // provider blocks (e.g. Google Gemini from Hong Kong), because the user's
    // browser is in a supported region. Opaque browser failures keep the
    // server-side diagnosis; real provider failures are appended to it.
    try {
      return await fetchCatalogDirect(provider, credential)
    } catch (directError) {
      throw combineCatalogErrors(serverError, directError)
    }
  }, { revalidateOnMount: enabled, revalidateOnFocus: false, revalidateOnReconnect: enabled, shouldRetryOnError: false, dedupingInterval: 60_000, keepPreviousData: false })
  return { ...swr, models: swr.data?.models ?? fallbackModels(provider), live: !!swr.data, credential }
}
