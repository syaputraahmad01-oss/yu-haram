import { PROVIDERS } from '@/lib/constants/models'
import { normalizeCatalog, type ModelOption } from './catalog'
import { guardedFetch } from '@/lib/security/ssrf'
import type { ProviderType } from '@/types'

export async function listProviderModels(provider: ProviderType, apiKey: string, signal: AbortSignal): Promise<ModelOption[]> {
  const url = new URL(PROVIDERS[provider].baseUrl + '/models')
  const headers = provider === 'gemini' ? { 'x-goog-api-key': apiKey } : apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
  if (provider === 'gemini') url.searchParams.set('pageSize', '1000')
  const models: ModelOption[] = []
  // SSRF + DNS rebinding enforcement happens on the socket: guardedFetch
  // resolves DNS itself, rejects forbidden addresses and pins the validated
  // IP for the connection. Ollama is the documented loopback exception.
  const allowLoopback = provider === 'ollama'
  for (let page = 0; page < 10; page++) {
    const response = await guardedFetch(url, { headers: headers as Record<string, string>, signal, cache: 'no-store', redirect: 'error', allowLoopback })
    if (!response.ok) throw { statusCode: response.status, responseBody: (await response.text()).slice(0, 20_000) }
    const payload = await response.json()
    if (!payload || typeof payload !== 'object' || !Array.isArray(provider === 'gemini' ? payload.models : payload.data)) throw new Error('Invalid provider catalog response')
    models.push(...normalizeCatalog(provider, payload))
    if (provider !== 'gemini' || typeof payload.nextPageToken !== 'string' || !payload.nextPageToken) return models
    url.searchParams.set('pageToken', payload.nextPageToken)
  }
  throw new Error('Provider catalog pagination limit exceeded')
}
