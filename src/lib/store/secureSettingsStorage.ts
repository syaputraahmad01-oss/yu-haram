/**
 * Encrypted localStorage adapter for the settings store.
 *
 * The zustand persist middleware keeps its usual JSON envelope in
 * localStorage, but `apiKeys` never touches disk in plaintext:
 *
 *   setItem → apiKeys are AES-256-GCM encrypted into `apiKeysEnc`
 *             (device key lives in IndexedDB, non-extractable)
 *   getItem → `apiKeysEnc` is decrypted back into `apiKeys` in memory
 *
 * If decryption fails (corrupt data, cleared IndexedDB, different device
 * key) the keys are treated as absent: the user simply re-enters them.
 * Writes are serialised so two quick setApiKey calls cannot reorder.
 */
import type { StateStorage } from 'zustand/middleware'
import { decryptFromStorage, encryptForStorage } from '@/lib/utils/encryption'
import type { ProviderType } from '@/types'

const PLAINTEXT_FIELD = 'apiKeys'
const ENCRYPTED_FIELD = 'apiKeysEnc'
const MAX_KEY_LENGTH = 4096

const KNOWN_PROVIDERS: ProviderType[] = ['gemini', 'groq', 'openrouter', 'ollama', 'kimi', 'qwen']

/** Keep only plausible credential entries; drop anything else silently. */
export function sanitizeApiKeys(value: unknown): Partial<Record<ProviderType, string>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const clean: Partial<Record<ProviderType, string>> = {}
  for (const [provider, key] of Object.entries(value as Record<string, unknown>)) {
    if (!KNOWN_PROVIDERS.includes(provider as ProviderType)) continue
    if (typeof key !== 'string') continue
    const trimmed = key.trim()
    if (trimmed.length > 0 && trimmed.length <= MAX_KEY_LENGTH) {
      clean[provider as ProviderType] = trimmed
    }
  }
  return clean
}

export const secureSettingsStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    if (typeof window === 'undefined') return null
    const raw = window.localStorage.getItem(name)
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw) as PersistEnvelope
      const state = parsed?.state
      if (state && typeof state === 'object') {
        if (typeof state[ENCRYPTED_FIELD] === 'string') {
          const keys = await decryptFromStorage<unknown>(state[ENCRYPTED_FIELD] as string)
          if (keys) state[PLAINTEXT_FIELD] = sanitizeApiKeys(keys)
          else delete state[PLAINTEXT_FIELD]
        } else {
          // No encrypted blob (legacy or keys cleared): never trust leftovers.
          delete state[PLAINTEXT_FIELD]
        }
        delete state[ENCRYPTED_FIELD]
      }
      return JSON.stringify(parsed)
    } catch {
      return null
    }
  },

  setItem: (name: string, value: string): Promise<void> => {
    if (typeof window === 'undefined') return Promise.resolve()
    const run = writeChain.then(() => write(name, value))
    writeChain = run.catch(() => {}) // keep the queue alive on failures
    return run
  },

  removeItem: (name: string): Promise<void> => {
    if (typeof window === 'undefined') return Promise.resolve()
    try { window.localStorage.removeItem(name) } catch { /* storage unavailable */ }
    return Promise.resolve()
  },
}

interface PersistEnvelope {
  state?: Record<string, unknown>
  version?: number
}

/** Serialised writes: older state snapshots must never overwrite newer ones. */
let writeChain: Promise<void> = Promise.resolve()

async function write(name: string, value: string): Promise<void> {
  let payload = value
  try {
    const parsed = JSON.parse(value) as PersistEnvelope
    const state = parsed?.state
    if (!state || typeof state !== 'object') throw new Error('Unexpected persist envelope')
    const keys = state[PLAINTEXT_FIELD]
    delete state[PLAINTEXT_FIELD] // plaintext keys must never reach localStorage
    if (keys && typeof keys === 'object' && !Array.isArray(keys)) {
      const clean = sanitizeApiKeys(keys)
      if (Object.keys(clean).length > 0) {
        try {
          state[ENCRYPTED_FIELD] = await encryptForStorage(clean)
        } catch {
          // WebCrypto/IndexedDB unavailable (e.g. insecure context): persist
          // the rest of the settings without the keys rather than failing.
        }
      }
    }
    payload = JSON.stringify(parsed)
  } catch {
    // Unparseable snapshot: refuse to write if it could contain plaintext keys.
    if (value.includes(`"${PLAINTEXT_FIELD}"`)) return
  }
  window.localStorage.setItem(name, payload)
}
