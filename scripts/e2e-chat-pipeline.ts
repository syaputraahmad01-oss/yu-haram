// E2E: prove the chat pipeline works end to end against the live dev server,
// using the mock OpenAI-compatible provider on 127.0.0.1:11434 (ollama port).
import { consumeAIStream } from '../src/lib/ai/stream'

const BASE = 'http://localhost:3000'
let failures = 0
function check(name: string, condition: boolean, detail = '') {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!condition) failures += 1
}

async function main() {
  // 1. Economy path: /api/chat streaming against the mock provider.
  const chatResponse = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': 'ollama-local' },
    body: JSON.stringify({
      provider: 'ollama',
      model: 'mock-model',
      messages: [{ role: 'user', content: 'Say hello' }],
      files: {},
      allowPaidModels: false,
    }),
  })
  check('POST /api/chat (ollama + mock) returns 200', chatResponse.status === 200, `status=${chatResponse.status}`)
  check('/api/chat streams NDJSON', (chatResponse.headers.get('content-type') || '').includes('x-ndjson'))

  const deltas: string[] = []
  const events: string[] = []
  const text = await consumeAIStream(chatResponse, {
    onDelta: delta => deltas.push(delta),
    onEvent: event => events.push(String(event.type)),
  })
  check('consumeAIStream reads the live /api/chat NDJSON stream', text === 'Hello from mock provider. Stream works end to end.', `text=${JSON.stringify(text)}`)
  check('client received delta events', deltas.length >= 2, `deltas=${deltas.length}`)
  check('stream finished with done event', events.includes('done'), `events=${events.join(',')}`)

  // 2. Provider error path: mock rejects the key; the real error must surface.
  const errorResponse = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': 'ollama-local' },
    body: JSON.stringify({
      provider: 'ollama',
      model: 'fail-model',
      messages: [{ role: 'user', content: 'Say hello' }],
      files: {},
    }),
  })
  check('POST /api/chat with failing model still returns 200 (streamed error)', errorResponse.status === 200)
  let thrown: Error | null = null
  try { await consumeAIStream(errorResponse) } catch (error) { thrown = error as Error }
  check('provider error is surfaced through consumeAIStream', !!thrown && /API key rejected/.test(thrown.message), `message=${thrown?.message}`)

  // 3. Orchestrate path with a non-trio primary provider key header (the false-401 fix).
  const orchestrateResponse = await fetch(`${BASE}/api/orchestrate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-yuha-key-ollama': 'ollama-local' },
    body: JSON.stringify({
      provider: 'ollama',
      model: 'mock-model',
      mode: 'balanced',
      allowPaidModels: false,
      messages: [{ role: 'user', content: 'Build a hello page' }],
      files: {},
    }),
  })
  check('POST /api/orchestrate with x-yuha-key-ollama returns 200 (no false 401)', orchestrateResponse.status === 200, `status=${orchestrateResponse.status}`)
  const orchestrateEvents: string[] = []
  const orchestrateText = await consumeAIStream(orchestrateResponse, {
    onEvent: event => orchestrateEvents.push(String(event.type)),
  })
  check('orchestrate stream delivers task output', orchestrateText.includes('Mock non-stream response'), `text=${JSON.stringify(orchestrateText.slice(0, 80))}`)
  check('orchestrate emits plan/done events', orchestrateEvents.includes('agent-plan') && orchestrateEvents.includes('done'), `events=${orchestrateEvents.join(',')}`)

  // 4. Guard still intact. Since the Pass 11/12 keyless-local fix, Ollama is a
  // documented no-credential runtime (200), while every cloud provider without
  // a key must still be rejected with 401.
  const noKeyResponse = await fetch(`${BASE}/api/orchestrate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: 'ollama',
      model: 'mock-model',
      mode: 'balanced',
      messages: [{ role: 'user', content: 'hi' }],
      files: {},
    }),
  })
  check('orchestrate keyless local runtime (ollama) is allowed (200)', noKeyResponse.status === 200, `status=${noKeyResponse.status}`)
  const noKeyCloudResponse = await fetch(`${BASE}/api/orchestrate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: 'gemini',
      model: 'gemini-3-pro',
      mode: 'economy',
      messages: [{ role: 'user', content: 'hi' }],
      files: {},
    }),
  })
  check('orchestrate cloud provider without key still returns 401', noKeyCloudResponse.status === 401, `status=${noKeyCloudResponse.status}`)

  console.log(failures === 0 ? '\nALL E2E CHECKS PASSED' : `\n${failures} E2E CHECK(S) FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(error => { console.error('E2E script crashed:', error); process.exit(1) })
