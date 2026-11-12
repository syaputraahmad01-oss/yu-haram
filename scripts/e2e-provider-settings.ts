/**
 * E2E for Pass 11 (provider settings repair) against the running dev server.
 *
 * Verifies through real HTTP:
 *  1. Ollama catalog listing works WITHOUT any API key (previously 401).
 *  2. Ollama connection test works WITHOUT any API key (previously 401).
 *  3. Cloud providers still REQUIRE the key (401 without it) — the free-first
 *     cost guard must not be weakened.
 *  4. The route now actually reads `x-api-key` for tests: a Gemini test with
 *     the old wrong header (`x-gemini-key`) still 401s, while `x-api-key`
 *     reaches the provider (fails at Google with a provider error, not 401).
 *  5. Chat pipeline still streams end to end (Pass 10 regression check).
 */
import type { ModelOption } from '../src/lib/ai/catalog'

const BASE = 'http://localhost:3000'
let passed = 0
let failed = 0

function check(name: string, condition: boolean, detail = '') {
  if (condition) { passed++; console.log(`  ✔ ${name}`) }
  else { failed++; console.error(`  ✖ ${name} ${detail}`) }
}

async function postProviders(body: object, headers: Record<string, string> = {}) {
  const response = await fetch(`${BASE}/api/providers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE, ...headers },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => ({}))
  return { status: response.status, payload }
}

async function main() {
  console.log('Pass 11 E2E — provider settings repair')

  // 1. Ollama keyless catalog listing
  const list = await postProviders({ provider: 'ollama', action: 'list' })
  // Typed with the real catalog model shape (not `any`) so strict mode holds.
  const models: ModelOption[] = Array.isArray(list.payload.models) ? list.payload.models : []
  check('ollama list tanpa key → 200 + katalog terisi', list.status === 200 && models.length >= 2,
    `status=${list.status} models=${models.length} err=${list.payload.error ?? ''}`)
  const freeModel = models.find(m => m.tier === 'free')
  check('katalog ollama ditandai gratis (lokal, free-first)', !!freeModel && freeModel.id === 'mock-model')

  // 2. Ollama keyless connection test (hits the mock provider's chat completion)
  const test = await postProviders({ provider: 'ollama', action: 'test', model: 'mock-model' })
  check('ollama test tanpa key → sukses (bukan 401)', test.status === 200 && test.payload.status === 'success',
    `status=${test.status} payload=${JSON.stringify(test.payload)}`)

  // 3. Cloud providers still gate on the key
  const geminiNoKey = await postProviders({ provider: 'gemini', action: 'list' })
  check('gemini list tanpa key → tetap 401 (proteksi tetap)', geminiNoKey.status === 401)
  const groqNoKey = await postProviders({ provider: 'groq', action: 'test', model: 'llama-3.3-70b-versatile' })
  check('groq test tanpa key → tetap 401 (proteksi tetap)', groqNoKey.status === 401)

  // 4. Header semantics for the test action
  const wrongHeader = await postProviders(
    { provider: 'gemini', action: 'test', model: 'gemini-2.5-flash' },
    { 'x-gemini-key': 'AIzaFakeKeyForHeaderCheck123' }
  )
  check('header lama x-gemini-key saja → 401 (tidak terbaca)', wrongHeader.status === 401,
    `status=${wrongHeader.status}`)
  const rightHeader = await postProviders(
    { provider: 'gemini', action: 'test', model: 'gemini-2.5-flash' },
    { 'x-api-key': 'AIzaFakeKeyForHeaderCheck123' }
  )
  check('x-api-key diteruskan ke Google → gagal di provider (502), bukan 401',
    rightHeader.status === 502 && /API key|401|403|kredensial|key/i.test(String(rightHeader.payload.error ?? '')),
    `status=${rightHeader.status} err=${rightHeader.payload.error ?? ''}`)

  // 5. Pass 10 regression: chat still streams through the mock provider
  const chatResponse = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE, 'x-yuha-key-ollama': 'not-needed' },
    body: JSON.stringify({
      provider: 'ollama',
      model: 'mock-model',
      messages: [{ role: 'user', content: 'halo mock' }],
      files: {},
    }),
  })
  const chatBody = await chatResponse.text()
  check('regresi Pass 10: /api/chat masih streaming NDJSON', chatResponse.status === 200 && chatBody.includes('"type":"delta"'),
    `status=${chatResponse.status} body=${chatBody.slice(0, 120)}`)

  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(error => { console.error(error); process.exit(1) })
