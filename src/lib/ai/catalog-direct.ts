/**
 * Browser-direct catalog fallback.
 *
 * Why this exists (evidence, 2026-11-12):
 * The model catalog is normally fetched server-side (POST /api/providers →
 * listProviderModels). Google's Gemini API only serves requests originating
 * from Google's documented available regions, and the restriction applies to
 * the ORIGIN OF THE REQUEST (the YUHA server), not to the user:
 * https://ai.google.dev/gemini-api/docs/available-regions
 * The current deployment egresses from Hong Kong (verified: 8.212.10.159,
 * Alibaba Cloud HK), which is NOT a supported region, so the server always
 * receives 400 FAILED_PRECONDITION ("User location is not supported for the
 * API use.") even when the user's key is valid — the user's browser is in a
 * supported region.
 *
 * The fallback therefore repeats the exact same catalog request directly from
 * the user's browser:
 *  - generativelanguage.googleapis.com returns permissive CORS headers
 *    (Access-Control-Allow-Origin echoes the request Origin — verified via
 *    curl with an Origin header), so the browser can read the response.
 *  - The API key never gains new exposure: it is user-entered and already
 *    stored in the browser; the direct call sends it straight to the
 *    provider's official HTTPS endpoint, not to any third party.
 *  - The URL is built only from the static PROVIDERS config (no user input).
 *  - For Ollama this fallback is strictly better: the browser can reach the
 *    user's own localhost:11434, which a remote server never could.
 * If the direct request is blocked (e.g. CORS), the original server-side
 * diagnosis is preserved verbatim — no silent failure.
 */

import { PROVIDERS } from '@/lib/constants/models'
import { normalizeCatalog, type ModelOption } from '@/lib/ai/catalog'
import type { ProviderType } from '@/types'

/** Extract the provider's own message from a JSON error body, if readable. */
export function providerJsonMessage(text: string): string {
  try {
    const parsed = JSON.parse(text) as { error?: unknown }
    const error = parsed?.error
    const message = error && typeof error === 'object' && 'message' in error
      ? (error as { message?: unknown }).message
      : undefined
    return typeof message === 'string' && message.trim() ? message.trim() : ''
  } catch {
    return ''
  }
}

export interface DirectCatalogResult {
  models: ModelOption[]
  checkedAt: number
  via: 'browser'
}

/** Same request shape as the server-side listProviderModels, issued by the browser. */
export async function fetchCatalogDirect(provider: ProviderType, credential: string): Promise<DirectCatalogResult> {
  const url = new URL(PROVIDERS[provider].baseUrl + '/models')
  if (provider === 'gemini') url.searchParams.set('pageSize', '1000')
  const headers: Record<string, string> = !credential
    ? {}
    : provider === 'gemini'
      ? { 'x-goog-api-key': credential }
      : { Authorization: `Bearer ${credential}` }
  const response = await fetch(url, { headers, cache: 'no-store', signal: AbortSignal.timeout(25_000) })
  const text = await response.text()
  if (!response.ok) {
    const detail = providerJsonMessage(text)
    throw new Error(detail ? `${detail} (HTTP ${response.status})` : `HTTP ${response.status}`)
  }
  const payload = JSON.parse(text) as Record<string, unknown>
  return { models: normalizeCatalog(provider, payload), checkedAt: Date.now(), via: 'browser' }
}

/**
 * Combine a failed server-side catalog fetch and a failed browser-direct
 * fetch into one honest message. A CORS-blocked direct fetch throws an
 * opaque browser error ("Failed to fetch"), which carries no diagnosis —
 * in that case the server-side message is the truthful one and is kept.
 */
export function combineCatalogErrors(serverError: unknown, directError: unknown): Error {
  const serverMessage = serverError instanceof Error && serverError.message
    ? serverError.message
    : 'Gagal mengambil katalog model.'
  const directMessage = directError instanceof Error && directError.message ? directError.message : ''
  if (!directMessage || /failed to fetch|networkerror|load failed/i.test(directMessage)) {
    return new Error(serverMessage)
  }
  return new Error(`${serverMessage} — Percobaan langsung dari browser juga gagal: ${directMessage}`)
}
