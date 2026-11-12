/**
 * Regression tests for the provider settings repair (Pass 11).
 *
 * Bug A: testModelConnection sent the credential as `x-<provider>-key`, but
 *        /api/providers reads `x-api-key`. Every "Tes" click failed with 401
 *        even though the key was saved.
 * Bug B: apiKeys were stripped from persistence (session-memory only), so
 *        every reload silently discarded all saved keys and the dynamic model
 *        catalogs stayed empty. Keys are now persisted AES-256-GCM encrypted
 *        with a device-bound, non-extractable key in IndexedDB.
 * Bug C: Ollama (local daemon, no credential) was forced through the API-key
 *        gate for catalog listing and connection tests.
 * Bug D: useConnectionStore persisted the raw credential into localStorage.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeApiKeys, secureSettingsStorage } from '../src/lib/store/secureSettingsStorage'
import { decryptFromStorage, encryptForStorage, resetDeviceCryptoKeyCache } from '../src/lib/utils/encryption'
import { catalogListsKeyless, generationWorksKeyless } from '../src/lib/ai/catalog'

/* ------------------------------------------------------------------ */
/* Browser fakes installed BEFORE the zustand stores are imported:     */
/* zustand persist resolves its storage backend at store creation.    */
/* ------------------------------------------------------------------ */

class MemoryStorage {
  private map = new Map<string, string>()
  getItem(name: string): string | null { return this.map.get(name) ?? null }
  setItem(name: string, value: string) { this.map.set(name, String(value)) }
  removeItem(name: string) { this.map.delete(name) }
  key(index: number): string | null { return [...this.map.keys()][index] ?? null }
  get length() { return this.map.size }
  clear() { this.map.clear() }
}

class FakeRequest<T = unknown> {
  result: T = undefined as unknown as T
  error: unknown = null
  onsuccess: (() => void) | null = null
  onerror: (() => void) | null = null
  onupgradeneeded: (() => void) | null = null
  onblocked: (() => void) | null = null
  settle(value: T) {
    this.result = value
    queueMicrotask(() => this.onsuccess?.())
  }
}

const idbStores = new Map<string, Map<string, unknown>>()

function installFakeIndexedDb() {
  const fakeDb = {
    objectStoreNames: { contains: (name: string) => idbStores.has(name) },
    createObjectStore: (name: string) => { idbStores.set(name, idbStores.get(name) ?? new Map()); return {} },
    transaction: (name: string) => ({
      objectStore: () => ({
        get: (key: string) => {
          const request = new FakeRequest<unknown>()
          request.settle(idbStores.get(name)?.get(key))
          return request
        },
        put: (value: unknown, key: string) => {
          const request = new FakeRequest<IDBValidKey>()
          idbStores.get(name)?.set(key, value)
          request.settle(key)
          return request
        },
      }),
    }),
    close: () => {},
  }
  ;(globalThis as Record<string, unknown>).indexedDB = {
    open: () => {
      const request = new FakeRequest<typeof fakeDb>()
      request.result = fakeDb
      queueMicrotask(() => {
        if (!idbStores.has('device-keys')) request.onupgradeneeded?.()
        request.onsuccess?.()
      })
      return request
    },
  }
}

const memoryStorage = new MemoryStorage()
const previousWindow = (globalThis as Record<string, unknown>).window
const previousIndexedDB = (globalThis as Record<string, unknown>).indexedDB
const previousLocalStorage = (globalThis as Record<string, unknown>).localStorage
;(globalThis as Record<string, unknown>).window = { localStorage: memoryStorage }
;(globalThis as Record<string, unknown>).localStorage = memoryStorage
installFakeIndexedDb()

test.after(() => {
  ;(globalThis as Record<string, unknown>).window = previousWindow
  ;(globalThis as Record<string, unknown>).indexedDB = previousIndexedDB
  ;(globalThis as Record<string, unknown>).localStorage = previousLocalStorage
  resetDeviceCryptoKeyCache()
})

/* ------------------------------------------------------------------ */
/* Bug A: connection test must authenticate via x-api-key              */
/* ------------------------------------------------------------------ */

test('testModelConnection sends the credential in the x-api-key header the route actually reads', async () => {
  const { testModelConnection } = await import('../src/lib/ai/test-connection')
  const { useConnectionStore } = await import('../src/lib/store/useConnectionStore')

  const originalFetch = globalThis.fetch
  const captured: Array<{ url: string; headers: Record<string, string>; body: unknown }> = []
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    captured.push({
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: JSON.parse(String(init?.body)),
    })
    return new Response(JSON.stringify({ status: 'success', latency: 12, checkedAt: Date.now() }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch

  try {
    useConnectionStore.getState().clearResults()
    const ok = await testModelConnection('gemini', 'gemini-2.5-flash', 'AIzaSyFakeKeyForTest123')
    assert.equal(ok, true)

    assert.equal(captured.length, 1)
    assert.equal(captured[0].url, '/api/providers')
    assert.equal(captured[0].headers['x-api-key'], 'AIzaSyFakeKeyForTest123')
    assert.equal(captured[0].headers['x-gemini-key'], undefined, 'wrong per-provider header must not be sent')
    assert.equal(captured[0].headers['Content-Type'], 'application/json')
    assert.deepEqual(captured[0].body, { action: 'test', provider: 'gemini', model: 'gemini-2.5-flash' })

    const result = useConnectionStore.getState().results['gemini:gemini-2.5-flash']
    assert.equal(result?.status, 'success')
    assert.equal(result?.credential, 'AIzaSyFakeKeyForTest123')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('testModelConnection records the provider error message when the route rejects the test', async () => {
  const { testModelConnection } = await import('../src/lib/ai/test-connection')

  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: 'Tambahkan API key Google Gemini terlebih dahulu.' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  })) as typeof fetch

  try {
    const ok = await testModelConnection('gemini', 'gemini-2.5-flash', '')
    assert.equal(ok, false)
    const { useConnectionStore } = await import('../src/lib/store/useConnectionStore')
    const result = useConnectionStore.getState().results['gemini:gemini-2.5-flash']
    assert.equal(result?.status, 'failed')
    assert.match(result?.error ?? '', /Tambahkan API key/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

/* ------------------------------------------------------------------ */
/* Bug B: keys are encrypted at rest and restored after "reload"       */
/* ------------------------------------------------------------------ */

test('secureSettingsStorage never writes plaintext keys and restores them on read', async () => {
  resetDeviceCryptoKeyCache()
  memoryStorage.clear()
  const snapshot = JSON.stringify({
    state: { apiKeys: { groq: 'gsk_super_secret_value_987654321', openrouter: 'sk-or-v1-abcdef123456' }, activeProvider: 'groq' },
    version: 7,
  })
  await secureSettingsStorage.setItem('yuha-settings', snapshot)

  const raw = memoryStorage.getItem('yuha-settings')
  assert.ok(raw, 'snapshot must be persisted')
  assert.ok(!raw.includes('gsk_super_secret_value_987654321'), 'plaintext key leaked into localStorage')
  assert.ok(!raw.includes('sk-or-v1-abcdef123456'), 'plaintext key leaked into localStorage')

  const stored = JSON.parse(raw as string)
  assert.equal(stored.state.apiKeys, undefined)
  assert.equal(typeof stored.state.apiKeysEnc, 'string')

  const restored = await secureSettingsStorage.getItem('yuha-settings')
  assert.ok(restored)
  const state = JSON.parse(restored).state
  assert.equal(state.apiKeys.groq, 'gsk_super_secret_value_987654321')
  assert.equal(state.apiKeys.openrouter, 'sk-or-v1-abcdef123456')
  assert.equal(state.apiKeysEnc, undefined)
})

test('settings store round-trips API keys through an encrypted persistence layer', async () => {
  const { useSettingsStore } = await import('../src/lib/store/useSettingsStore')

  resetDeviceCryptoKeyCache()
  memoryStorage.clear()
  useSettingsStore.setState({ apiKeys: {}, activeProvider: 'groq', activeModel: '' })
  useSettingsStore.getState().setApiKey('groq', 'gsk_roundtrip_key_value_42')
  useSettingsStore.getState().setApiKey('gemini', 'AIzaRoundTripKey999999')

  // Persist writes are queued asynchronously; give the crypto layer a moment.
  await new Promise(resolve => setTimeout(resolve, 150))

  const raw = memoryStorage.getItem('yuha-settings')
  assert.ok(raw)
  assert.ok(!raw.includes('gsk_roundtrip_key_value_42'), 'plaintext groq key leaked')
  assert.ok(!raw.includes('AIzaRoundTripKey999999'), 'plaintext gemini key leaked')

  // Simulate a page reload: memory cleared, then rehydrated from storage.
  useSettingsStore.setState({ apiKeys: {} })
  assert.equal(useSettingsStore.getState().apiKeys.groq, undefined)
  await useSettingsStore.persist.rehydrate()
  assert.equal(useSettingsStore.getState().apiKeys.groq, 'gsk_roundtrip_key_value_42')
  assert.equal(useSettingsStore.getState().apiKeys.gemini, 'AIzaRoundTripKey999999')

  useSettingsStore.getState().removeApiKey('groq')
  await new Promise(resolve => setTimeout(resolve, 150))
  const afterRemove = memoryStorage.getItem('yuha-settings') ?? ''
  assert.ok(!afterRemove.includes('gsk_roundtrip_key_value_42'), 'removed key must leave encrypted storage')
})

test('corrupt ciphertext is treated as absent instead of crashing or leaking', async () => {
  resetDeviceCryptoKeyCache()
  memoryStorage.clear()
  memoryStorage.setItem('yuha-settings', JSON.stringify({
    state: { apiKeysEnc: 'not-valid-base64-payload!!', activeProvider: 'gemini' },
    version: 7,
  }))
  const restored = await secureSettingsStorage.getItem('yuha-settings')
  assert.ok(restored)
  const state = JSON.parse(restored).state
  assert.equal(state.apiKeys, undefined)
  assert.equal(state.activeProvider, 'gemini')
})

test('legacy v6 snapshot (no keys) migrates cleanly to v7', async () => {
  const { useSettingsStore } = await import('../src/lib/store/useSettingsStore')

  resetDeviceCryptoKeyCache()
  memoryStorage.clear()
  useSettingsStore.setState({ apiKeys: {}, activeProvider: 'gemini', activeModel: 'old-model' })
  memoryStorage.setItem('yuha-settings', JSON.stringify({
    state: { activeProvider: 'groq', activeModel: 'llama-3.3-70b-versatile', allowPaidModels: true, collaborationMode: 'max' },
    version: 6,
  }))
  await useSettingsStore.persist.rehydrate()
  const state = useSettingsStore.getState()
  assert.equal(state.activeProvider, 'groq')
  assert.equal(state.activeModel, 'llama-3.3-70b-versatile')
  assert.equal(state.allowPaidModels, true)
  assert.deepEqual(state.apiKeys, {}, 'legacy snapshot had no keys to restore')
})

test('sanitizeApiKeys keeps only plausible provider credentials', () => {
  const clean = sanitizeApiKeys({
    gemini: '  AIzaSyValidLength  ',
    groq: 'gsk_valid',
    openrouter: '',
    ollama: '   ',
    kimi: 12345,
    qwen: true,
    evil: 'x'.repeat(20),
    ['__proto__']: 'nope',
  })
  assert.deepEqual(clean, { gemini: 'AIzaSyValidLength', groq: 'gsk_valid' })

  const oversized = sanitizeApiKeys({ gemini: 'k'.repeat(5000) })
  assert.deepEqual(oversized, {})
  assert.deepEqual(sanitizeApiKeys(null), {})
  assert.deepEqual(sanitizeApiKeys('nope'), {})
})

test('encryption helpers round-trip JSON payloads', async () => {
  resetDeviceCryptoKeyCache()
  const payload = { hello: 'world', nested: { list: [1, 2, 3] }, key: 'AIzaSecret' }
  const encrypted = await encryptForStorage(payload)
  assert.notEqual(encrypted, JSON.stringify(payload))
  assert.ok(!encrypted.includes('AIzaSecret'))
  const decrypted = await decryptFromStorage<typeof payload>(encrypted)
  assert.deepEqual(decrypted, payload)
  assert.equal(await decryptFromStorage('garbage!!'), null)
})

/* ------------------------------------------------------------------ */
/* Bug C: local/keyless providers bypass the credential gate           */
/* ------------------------------------------------------------------ */

test('keyless catalog and generation rules keep Ollama usable without a credential', () => {
  assert.equal(catalogListsKeyless('openrouter'), true)
  assert.equal(catalogListsKeyless('ollama'), true)
  assert.equal(catalogListsKeyless('gemini'), false)
  assert.equal(catalogListsKeyless('groq'), false)
  assert.equal(catalogListsKeyless('kimi'), false)
  assert.equal(catalogListsKeyless('qwen'), false)

  assert.equal(generationWorksKeyless('ollama'), true)
  assert.equal(generationWorksKeyless('openrouter'), false, 'OpenRouter generation still requires a key')
  assert.equal(generationWorksKeyless('gemini'), false)
})

/* ------------------------------------------------------------------ */
/* Bug D: connection results never persist the raw credential          */
/* ------------------------------------------------------------------ */

test('connection store partialize strips credentials before persisting', async () => {
  const { useConnectionStore } = await import('../src/lib/store/useConnectionStore')

  useConnectionStore.getState().setResult('groq:llama-3.3-70b-versatile', {
    status: 'failed',
    credential: 'gsk_raw_secret_must_not_persist',
    checkedAt: 1234,
    error: 'boom',
  })
  const persistOptions = useConnectionStore.persist.getOptions()
  const partial = persistOptions.partialize?.(useConnectionStore.getState()) as
    | { results?: Record<string, { credential?: string; status?: string; error?: string }> }
    | undefined
  assert.ok(partial?.results)
  const entry = partial.results['groq:llama-3.3-70b-versatile']
  assert.equal(entry?.credential, undefined, 'credential must not be persisted')
  assert.equal(entry?.status, 'failed')
  assert.equal(entry?.error, 'boom')
  // The in-memory copy still carries the credential for key-match checks.
  assert.equal(useConnectionStore.getState().results['groq:llama-3.3-70b-versatile']?.credential, 'gsk_raw_secret_must_not_persist')

  // And the serialized payload written to localStorage contains no secret.
  const persisted = memoryStorage.getItem('yuha-connections-storage') ?? ''
  assert.ok(!persisted.includes('gsk_raw_secret_must_not_persist'), 'raw credential leaked to localStorage')
  assert.ok(persisted.includes('llama-3.3-70b-versatile'), 'result metadata is still persisted')
})
