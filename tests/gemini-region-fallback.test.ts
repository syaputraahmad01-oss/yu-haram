/**
 * Regression tests for the Gemini catalog region-block fix (2026-11-12).
 *
 * Evidence chain being locked in by these tests:
 * 1. Google serves the Gemini API only from its documented available regions;
 *    the restriction applies to the request origin (the YUHA server), and this
 *    deployment egresses from Hong Kong (not a supported region). The server
 *    therefore receives 400 FAILED_PRECONDITION even with a valid user key.
 * 2. providerErrorMessage must say exactly that instead of the misleading
 *    generic "provider rejected the request (400)".
 * 3. The catalog hook falls back to a browser-direct fetch; the helpers that
 *    make that path safe and honest are tested here.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { providerErrorMessage } from '../src/lib/ai/errors'
import { providerJsonMessage, fetchCatalogDirect, combineCatalogErrors } from '../src/lib/ai/catalog-direct'

test('Google region-block 400 is reported as a deployment-region problem, not a generic model error', () => {
  const error = {
    statusCode: 400,
    responseBody: JSON.stringify({
      error: {
        code: 400,
        message: 'User location is not supported for the API use.',
        status: 'FAILED_PRECONDITION',
      },
    }),
  }
  const message = providerErrorMessage(error, 'gemini', 'catalog')
  assert.match(message, /available regions/)
  assert.match(message, /server's region/)
  assert.doesNotMatch(message, /may not support the current request settings/)
})

test('Generic 400 now carries the provider response excerpt for diagnosability', () => {
  const error = {
    statusCode: 400,
    responseBody: '{"error":{"code":400,"message":"Some undocumented refusal reason","status":"INVALID_ARGUMENT"}}',
  }
  const message = providerErrorMessage(error, 'groq', 'catalog')
  assert.match(message, /provider rejected the request \(400\)/)
  assert.match(message, /Provider response: "Some undocumented refusal reason"/)
})

test('API key rejection mapping still wins over the excerpt for invalid keys', () => {
  const error = {
    statusCode: 400,
    responseBody: '{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}',
  }
  const message = providerErrorMessage(error, 'gemini', 'catalog')
  assert.match(message, /API key rejected/)
  assert.doesNotMatch(message, /available regions/)
})

test('providerJsonMessage extracts Google-style error messages and rejects noise', () => {
  assert.equal(providerJsonMessage('{"error":{"code":400,"message":"User location is not supported for the API use."}}'), 'User location is not supported for the API use.')
  assert.equal(providerJsonMessage('not json at all'), '')
  assert.equal(providerJsonMessage('{"error":{"code":400}}'), '')
  assert.equal(providerJsonMessage('{"error":"plain string"}'), '')
})

test('fetchCatalogDirect sends Gemini auth via x-goog-api-key and normalizes the catalog', async () => {
  const requested: { url: string; init: RequestInit }[] = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requested.push({ url: String(input), init: init ?? {} })
    return new Response(JSON.stringify({
      models: [
        { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'], inputTokenLimit: 1048576 },
        { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
      ],
    }), { status: 200 })
  }) as typeof fetch
  try {
    const result = await fetchCatalogDirect('gemini', 'test-key-123')
    assert.equal(result.via, 'browser')
    assert.equal(result.models.length, 1)
    assert.equal(result.models[0].id, 'gemini-2.5-flash')
    assert.equal(result.models[0].contextWindow, 1048576)
    assert.equal(requested.length, 1)
    assert.match(requested[0].url, /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\?pageSize=1000$/)
    assert.equal((requested[0].init.headers as Record<string, string>)['x-goog-api-key'], 'test-key-123')
    assert.equal((requested[0].init.headers as Record<string, string>).Authorization, undefined)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('fetchCatalogDirect surfaces the provider message on HTTP failure', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response(
    '{"error":{"code":403,"message":"Requests from referer are blocked."}}',
    { status: 403 },
  )) as typeof fetch
  try {
    await assert.rejects(
      fetchCatalogDirect('groq', 'k'),
      /Requests from referer are blocked\. \(HTTP 403\)/,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Opaque browser failures keep the server-side diagnosis verbatim', () => {
  const serverError = new Error('Google Gemini (catalog): API key rejected. Replace the key for this provider in Settings.')
  const combined = combineCatalogErrors(serverError, new TypeError('Failed to fetch'))
  assert.equal(combined.message, serverError.message)
})

test('Real browser-direct failures are appended to the server-side diagnosis', () => {
  const serverError = new Error('Google Gemini (catalog): API key rejected.')
  const combined = combineCatalogErrors(serverError, new Error('Requests from referer are blocked. (HTTP 403)'))
  assert.match(combined.message, /API key rejected\./)
  assert.match(combined.message, /Percobaan langsung dari browser juga gagal: Requests from referer are blocked\./)
})
