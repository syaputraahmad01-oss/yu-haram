import { useConnectionStore } from '@/lib/store/useConnectionStore'
import type { ProviderType } from '@/types'

export async function testModelConnection(
  provider: ProviderType,
  model: string,
  credential: string
): Promise<boolean> {
  const key = `${provider}:${model}`
  const connectionStore = useConnectionStore.getState()
  connectionStore.setResult(key, { status: 'testing', credential })

  const startTime = Date.now()
  try {
    const res = await fetch('/api/providers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // The /api/providers route reads the credential from `x-api-key`;
        // per-provider headers (`x-<provider>-key`) are only used by the chat
        // orchestration endpoints. Sending the wrong header made every test
        // fail with 401 even though the key was saved.
        'x-api-key': credential,
      },
      body: JSON.stringify({
        action: 'test',
        provider,
        model,
      }),
    })

    const latency = Date.now() - startTime
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}))
      const errorMsg = errorData.error || `HTTP ${res.status} ${res.statusText}`
      connectionStore.setResult(key, {
        status: 'failed',
        credential,
        checkedAt: Date.now(),
        error: errorMsg,
      })
      return false
    }

    connectionStore.setResult(key, {
      status: 'success',
      credential,
      checkedAt: Date.now(),
      latency,
    })
    return true
  } catch (err) {
    connectionStore.setResult(key, {
      status: 'failed',
      credential,
      checkedAt: Date.now(),
      error: err instanceof Error ? err.message : 'Network error',
    })
    return false
  }
}
