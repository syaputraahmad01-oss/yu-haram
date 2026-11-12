/**
 * Credential helpers for the browser.
 *
 * API keys are persisted at rest only in AES-256-GCM encrypted form. The
 * encryption key is a non-extractable CryptoKey generated once per device and
 * stored in IndexedDB (structured clone keeps it opaque to JavaScript), so a
 * casual read of localStorage never reveals plaintext credentials. Decryption
 * is only possible from this same browser profile.
 */

export function maskKey(value: string) {
  return value.length > 8 ? value.slice(0, 4) + '••••' + value.slice(-4) : '••••••••'
}

/* ------------------------------------------------------------------ */
/* AES-256-GCM primitives (WebCrypto, secure contexts)                 */
/* ------------------------------------------------------------------ */

const IV_LENGTH = 12

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function subtle(): SubtleCrypto {
  const api = globalThis.crypto?.subtle
  if (!api) throw new Error('WebCrypto unavailable (insecure context)')
  return api
}

/** Encrypt any JSON-serialisable value. Output: base64(iv ‖ ciphertext). */
export async function encryptForStorage(value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const data = new TextEncoder().encode(JSON.stringify(value))
  const cipher = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, await getDeviceCryptoKey(), data))
  const packed = new Uint8Array(IV_LENGTH + cipher.length)
  packed.set(iv, 0)
  packed.set(cipher, IV_LENGTH)
  return toBase64(packed)
}

/** Decrypt a payload produced by {@link encryptForStorage}. Returns null on any failure. */
export async function decryptFromStorage<T>(payload: string): Promise<T | null> {
  try {
    const packed = fromBase64(payload)
    if (packed.length <= IV_LENGTH) return null
    const iv = packed.slice(0, IV_LENGTH)
    const data = packed.slice(IV_LENGTH)
    const plain = await subtle().decrypt({ name: 'AES-GCM', iv }, await getDeviceCryptoKey(), data)
    return JSON.parse(new TextDecoder().decode(plain)) as T
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ */
/* Device key storage (IndexedDB, non-extractable CryptoKey)           */
/* ------------------------------------------------------------------ */

const DEVICE_DB_NAME = 'yuha-secure-store'
const DEVICE_STORE = 'device-keys'
const DEVICE_KEY_ID = 'api-keys-aes-256-gcm'

function openDeviceDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DEVICE_DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(DEVICE_STORE)) db.createObjectStore(DEVICE_STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'))
    request.onblocked = () => reject(new Error('IndexedDB blocked by another tab'))
  })
}

function idbRequest<T>(operation: () => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = operation()
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

function isAesGcmSecretKey(value: unknown): value is CryptoKey {
  if (typeof CryptoKey !== 'undefined' && value instanceof CryptoKey) return true
  // Environments without the global CryptoKey class: duck-type the stored key.
  const candidate = value as CryptoKey | null | undefined
  return !!candidate
    && typeof candidate === 'object'
    && candidate.type === 'secret'
    && (candidate.algorithm as Algorithm | undefined)?.name === 'AES-GCM'
    && typeof candidate.usages?.includes === 'function'
}

let deviceKeyPromise: Promise<CryptoKey> | null = null

/**
 * Get (or lazily create) the device-bound AES-256 key. The key is generated
 * with `extractable: false`, so it can never be read out of IndexedDB — not
 * by page script, not by a localStorage dump.
 */
export async function getDeviceCryptoKey(): Promise<CryptoKey> {
  if (typeof indexedDB === 'undefined') throw new Error('IndexedDB unavailable')
  if (!deviceKeyPromise) {
    deviceKeyPromise = (async () => {
      const db = await openDeviceDb()
      try {
        const existing = await idbRequest<CryptoKey | undefined>(
          () => db.transaction(DEVICE_STORE, 'readonly').objectStore(DEVICE_STORE).get(DEVICE_KEY_ID)
        )
        if (isAesGcmSecretKey(existing)) return existing
        const created = await subtle().generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
        await idbRequest(
          () => db.transaction(DEVICE_STORE, 'readwrite').objectStore(DEVICE_STORE).put(created, DEVICE_KEY_ID)
        )
        return created
      } finally {
        db.close()
      }
    })().catch(error => {
      deviceKeyPromise = null // allow retry on transient failures
      throw error
    })
  }
  return deviceKeyPromise
}

/** Test-only: forget the cached device key promise. */
export function resetDeviceCryptoKeyCache(): void {
  deviceKeyPromise = null
}
