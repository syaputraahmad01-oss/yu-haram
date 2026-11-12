/**
 * Regression tests for the YUHA chat store persistence bug.
 *
 * Bug: useChatStore persisted EVERY field including the transient `isStreaming` flag.
 * A page reload (or tab close) in the middle of a generation froze `isStreaming: true`
 * into localStorage; after hydration every subsequent send was silently swallowed
 * (`if (chat.isStreaming) return`) and the composer stayed on "Building your idea"
 * forever — the user could not send any message.
 *
 * Fix: partialize persists only messages + draft; migrate strips legacy transient
 * fields from pre-v1 payloads; onRehydrateStorage force-clears transient flags.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

// Minimal localStorage polyfill BEFORE the store module is imported
// (zustand persist resolves its storage backend at store creation time).
class MemoryStorage {
  private map = new Map<string, string>()
  getItem(key: string) { return this.map.has(key) ? this.map.get(key)! : null }
  setItem(key: string, value: string) { this.map.set(key, String(value)) }
  removeItem(key: string) { this.map.delete(key) }
  clear() { this.map.clear() }
}
const storage = new MemoryStorage()
;(globalThis as unknown as { localStorage: unknown }).localStorage = storage

const STORAGE_KEY = 'yuha-chat-storage'

test('chat store heals a stuck isStreaming from localStorage and never persists transient flags', async () => {
  const { useChatStore } = await import('../src/lib/store/useChatStore')

  // Scenario 1 — exactly what a user who reloaded mid-generation has on disk today:
  // a pre-v1 payload whose persisted state still carries isStreaming: true.
  storage.setItem(STORAGE_KEY, JSON.stringify({
    state: {
      messages: [{ id: 'm1', role: 'user', content: 'halo', timestamp: 1 }],
      isStreaming: true,
      error: 'stale error',
      statusNotice: 'stale notice',
      draft: 'pesanku',
    },
    version: 0,
  }))

  await useChatStore.persist.rehydrate()

  const state = useChatStore.getState()
  assert.equal(state.isStreaming, false, 'isStreaming must be reset after hydration')
  assert.equal(state.error, null, 'stale error must be cleared after hydration')
  assert.equal(state.statusNotice, null, 'stale status notice must be cleared after hydration')
  assert.equal(state.messages.length, 1, 'messages must survive hydration')
  assert.equal(state.messages[0].content, 'halo')
  assert.equal(state.draft, 'pesanku', 'draft must survive hydration')

  // Scenario 2 — after this fix, transient flags must never reach storage again.
  state.setDraft('uji tulis')
  state.addMessage({ role: 'user', content: 'pesan uji' })
  state.setStreaming(true)
  state.setError('transient')

  const raw = storage.getItem(STORAGE_KEY)
  assert.ok(raw, 'persist middleware must write to storage on state change')
  const persisted = JSON.parse(raw!) as { state: Record<string, unknown>; version: number }
  assert.equal(persisted.version, 1)
  assert.ok(Array.isArray(persisted.state.messages), 'messages must be persisted')
  assert.equal(persisted.state.draft, 'uji tulis', 'draft must be persisted')
  assert.ok(!('isStreaming' in persisted.state), 'isStreaming must never be persisted')
  assert.ok(!('error' in persisted.state), 'error must never be persisted')
  assert.ok(!('statusNotice' in persisted.state), 'statusNotice must never be persisted')

  // Scenario 3 — rehydrating after a fresh write still heals any in-flight flag.
  await useChatStore.persist.rehydrate()
  assert.equal(useChatStore.getState().isStreaming, false)
  assert.equal(useChatStore.getState().error, null)
})
