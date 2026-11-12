/**
 * Regression tests for the chat streaming protocol.
 *
 * Bug: /api/chat and /api/orchestrate stream newline-delimited JSON (NDJSON),
 * but consumeAIStream only parsed SSE `data: ` lines. Every delta was silently
 * dropped, so every successful generation ended as "Model returned no text"
 * and the user could not send any message. Provider `{"type":"error"}` events
 * were also swallowed, hiding the real failure reason.
 *
 * A second cable: /api/orchestrate only read key headers for the core trio
 * (gemini/groq/openrouter), so a kimi/qwen/ollama primary provider with a
 * saved key was falsely rejected with 401. buildOrchestrationHeaders now
 * always includes the active provider.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { consumeAIStream } from '../src/lib/ai/stream'
import { buildOrchestrationHeaders } from '../src/lib/ai/orchestration'
import type { ProviderType } from '../src/types'

const encoder = new TextEncoder()

function streamResponse(chunks: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return new Response(body, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' } })
}

test('consumeAIStream parses NDJSON events emitted by /api/chat and /api/orchestrate', async () => {
  const deltas: string[] = []
  const events: Array<Record<string, unknown>> = []
  const text = await consumeAIStream(streamResponse([
    '{"type":"stage","message":"Menyusun rencana"}\n',
    '{"type":"delta","text":"Hello"}\n',
    '{"type":"delta","text":" world"}\n',
    '{"type":"done"}\n',
  ]), {
    onDelta: delta => deltas.push(delta),
    onEvent: event => events.push(event),
  })
  assert.equal(text, 'Hello world')
  assert.deepEqual(deltas, ['Hello', ' world'])
  assert.equal(events.filter(event => event.type === 'delta').length, 2)
  assert.ok(events.some(event => event.type === 'stage'))
  assert.ok(events.some(event => event.type === 'done'))
})

test('consumeAIStream still parses SSE data lines for backward compatibility', async () => {
  const deltas: string[] = []
  const text = await consumeAIStream(streamResponse([
    'data: {"delta":"Hi"}\n\n',
    'data: {"text":" there"}\n',
    'data: [DONE]\n',
  ]), { onDelta: delta => deltas.push(delta) })
  assert.equal(text, 'Hi there')
  assert.deepEqual(deltas, ['Hi', ' there'])
})

test('consumeAIStream buffers events split across chunk boundaries', async () => {
  const text = await consumeAIStream(streamResponse([
    '{"type":"delta","tex',
    't":"foo"}\n{"type":"delta","text":"bar"}',
    '\n{"type":"done"}\n',
  ]))
  assert.equal(text, 'foobar')
})

test('consumeAIStream flushes a trailing line that is not newline-terminated', async () => {
  const text = await consumeAIStream(streamResponse(['{"type":"delta","text":"end"}']))
  assert.equal(text, 'end')
})

test('consumeAIStream accepts both delta and text payload fields', async () => {
  const text = await consumeAIStream(streamResponse([
    '{"delta":"a"}\n',
    '{"text":"b"}\n',
  ]))
  assert.equal(text, 'ab')
})

test('consumeAIStream throws the provider error from {"type":"error"} events', async () => {
  const events: Array<Record<string, unknown>> = []
  await assert.rejects(
    consumeAIStream(streamResponse([
      '{"type":"delta","text":"partial"}\n',
      '{"type":"error","error":"Gemini API key not valid. Please pass a valid API key."}\n',
    ]), { onEvent: event => events.push(event) }),
    /Gemini API key not valid/
  )
  assert.ok(events.some(event => event.type === 'error'))
})

test('consumeAIStream ignores keepalives, blank lines and unparseable noise', async () => {
  const deltas: string[] = []
  const text = await consumeAIStream(streamResponse([
    ': keepalive\n\n',
    '\n',
    'not-json-at-all\n',
    '   \n',
    '{"type":"delta","text":"ok"}\n',
  ]), { onDelta: delta => deltas.push(delta) })
  assert.equal(text, 'ok')
  assert.deepEqual(deltas, ['ok'])
})

test('consumeAIStream rejects when the response body is empty', async () => {
  await assert.rejects(consumeAIStream(new Response(null)), /Response body is empty/)
})

test('buildOrchestrationHeaders includes the active provider key even outside the core trio', () => {
  const apiKeys: Partial<Record<ProviderType, string>> = { kimi: 'kimi-key', gemini: 'gem-key' }
  const headers = buildOrchestrationHeaders(provider => apiKeys[provider] || '', 'kimi')
  assert.equal(headers['Content-Type'], 'application/json')
  assert.equal(headers['x-yuha-key-kimi'], 'kimi-key')
  assert.equal(headers['x-yuha-key-gemini'], 'gem-key')
  assert.equal(headers['x-yuha-key-groq'], undefined)
  assert.equal(headers['x-yuha-key-openrouter'], undefined)
})

test('buildOrchestrationHeaders does not duplicate the active provider when it is a core provider', () => {
  const headerKeys = Object.keys(buildOrchestrationHeaders(() => 'same-key', 'groq'))
    .filter(name => name.startsWith('x-yuha-key-groq'))
  assert.deepEqual(headerKeys, ['x-yuha-key-groq'])
})
