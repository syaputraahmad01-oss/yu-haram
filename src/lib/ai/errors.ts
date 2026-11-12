import { PROVIDERS } from '@/lib/constants/models'
import type { ProviderType } from '@/types'

export function providerErrorMessage(error: unknown, provider: ProviderType, model: string): string {
  const pending: unknown[] = [error]
  const visited = new Set<object>()
  const statuses: number[] = []
  const details: string[] = []
  while (pending.length && visited.size < 20) {
    const current = pending.shift()
    if (!current || typeof current !== 'object' || visited.has(current)) continue
    visited.add(current)
    const item = current as Record<string, unknown>
    if (typeof item.statusCode === 'number') statuses.push(item.statusCode)
    for (const field of ['message', 'responseBody', 'code']) {
      if (typeof item[field] === 'string') details.push(item[field].slice(0, 20_000))
    }
    pending.push(item.cause, item.lastError)
    if (Array.isArray(item.errors)) pending.push(...item.errors.slice(-10))
  }
  const status = statuses.at(-1)
  const detail = details.join(' ').toLowerCase()
  // Original-casing excerpt of the provider's own response, kept for
  // diagnosability: generic 400s used to hide WHY the provider refused
  // (e.g. "User location is not supported for the API use." vs a bad key).
  // JSON bodies are unwrapped to their error.message when possible.
  const providerSaid = details
    .map(raw => {
      if (typeof raw !== 'string') return ''
      try {
        const parsed = JSON.parse(raw) as { error?: unknown; message?: unknown }
        const inner = parsed.error
        if (typeof inner === 'string' && inner.trim()) return inner.trim()
        if (inner && typeof inner === 'object' && 'message' in inner && typeof (inner as { message?: unknown }).message === 'string') {
          return (inner as { message: string }).message.trim()
        }
        if (typeof parsed.message === 'string' && parsed.message.trim()) return parsed.message.trim()
      } catch { /* not JSON — keep raw text */ }
      return raw
    })
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240)
  const name = PROVIDERS[provider].name
  const context = `${name} (${model})`
  if (status === 401 || /api_key_invalid|invalid_api_key|api key not valid|incorrect api key/.test(detail)) return `${context}: API key rejected. Replace the key for this provider in Settings.`
  if (status === 402 || /insufficient_quota|insufficient.balance|insufficient.credit|billing_not_active/.test(detail)) return `${context}: no API credits or billing quota available. Check billing in your provider account; retrying with the same key will not fix this.`
  if (status === 429) return `${context}: API quota or rate limit exceeded (429). Check this model's quota and billing in your provider account. If the quota is available, wait before retrying.`
  if (status === 403) return `${context}: access denied (403). Check the key's API permissions, model access, and regional restrictions in your provider account.`
  // Google rejects requests whose ORIGIN (this server) sits outside its
  // documented available regions — notably Hong Kong — with 400
  // FAILED_PRECONDITION "User location is not supported for the API use."
  // This is a deployment-location problem, not a key or model problem.
  if (/user location is not supported|location is not supported for the api/.test(detail)) {
    return `${context}: the provider serves this API only from its documented available regions and rejected this server's region (${status ?? 400}). The model catalog is retried directly from your browser automatically; generating with this provider requires a YUHA deployment in a supported region or a different provider.`
  }
  if (status === 404 || /model_not_found|model.*does not exist|model.*not supported/.test(detail)) return `${context}: model unavailable for this key. Open Settings, refresh the provider model catalog, select an available recommended model, and test its connection.`
  if (status === 400 || status === 422) {
    if (/context.length|context.window|too many tokens|token.limit|maximum context/.test(detail)) return `${context}: project or conversation exceeds this model's token limit. Start a new conversation or reduce the project context.`
    return `${context}: provider rejected the request (${status}). The selected model may not support the current request settings. Try another model or provider.${providerSaid ? ` Provider response: "${providerSaid}"` : ''}`
  }
  if (status && status >= 500) return `${context}: provider temporarily unavailable (${status}). Retry later or switch providers.`
  if (/fetch failed|network|econn|enotfound|timeout|timed out/.test(detail)) return `${context}: connection to the provider failed. Retry later or switch providers.`
  return `${context}: request failed. Try another model or provider; if it persists, check the provider's service status.${providerSaid ? ` Provider response: "${providerSaid}"` : ''}`
}
