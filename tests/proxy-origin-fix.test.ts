/**
 * Regression tests for the reverse-proxy-aware CSRF origin check.
 *
 * Bug: requests forwarded by the preview gateway arrive with the browser Origin
 * (https://preview-*.space-z.ai) but an internal request.url (http://localhost:3000),
 * so rejectCrossOrigin rejected every POST with 403 and the app appeared dead.
 * The fix accepts Origin when it matches the forwarded host (x-forwarded-host /
 * x-forwarded-proto / host), while still rejecting genuinely cross-site requests.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { rejectCrossOrigin } from '../src/lib/deploy/validate'

const PROXIED_ORIGIN = 'https://preview-chat-example.space-z.ai'

function requestWith(headers: Record<string, string>, url = 'http://localhost:3000/api/providers') {
  return new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers } })
}

test('rejectCrossOrigin still blocks genuinely cross-site browser requests', () => {
  const blocked = rejectCrossOrigin(requestWith({ 'sec-fetch-site': 'cross-site' }))
  assert.ok(blocked)
  assert.equal(blocked!.status, 403)
})

test('rejectCrossOrigin still blocks a foreign Origin that matches no known host', () => {
  const blocked = rejectCrossOrigin(requestWith({ origin: 'https://evil.example.com' }))
  assert.ok(blocked)
  assert.equal(blocked!.status, 403)
})

test('rejectCrossOrigin rejects malformed Origin headers', () => {
  const blocked = rejectCrossOrigin(requestWith({ origin: 'not-a-url' }))
  assert.ok(blocked)
  assert.equal(blocked!.status, 400)
})

test('rejectCrossOrigin allows same-origin requests (direct host access)', () => {
  const allowed = rejectCrossOrigin(requestWith({ origin: 'http://localhost:3000' }))
  assert.equal(allowed, null)
})

test('rejectCrossOrigin allows Origin matching x-forwarded-host behind a proxy', () => {
  const allowed = rejectCrossOrigin(
    requestWith({
      origin: PROXIED_ORIGIN,
      'x-forwarded-host': 'preview-chat-example.space-z.ai',
      'x-forwarded-proto': 'https',
    })
  )
  assert.equal(allowed, null)
})

test('rejectCrossOrigin allows Origin matching the host header when proto header is absent', () => {
  const allowed = rejectCrossOrigin(
    requestWith({
      origin: PROXIED_ORIGIN,
      host: 'preview-chat-example.space-z.ai',
    })
  )
  assert.equal(allowed, null)
})

test('rejectCrossOrigin handles comma-separated forwarded host chains', () => {
  const allowed = rejectCrossOrigin(
    requestWith({
      origin: PROXIED_ORIGIN,
      'x-forwarded-host': 'internal-gateway.local, preview-chat-example.space-z.ai',
      'x-forwarded-proto': 'https',
    })
  )
  assert.equal(allowed, null)
})

test('rejectCrossOrigin allows requests the browser attests as same-origin, regardless of proxy Host rewrites', () => {
  // This is the exact preview-gateway scenario: the browser loaded the page on
  // preview-chat-*.space-z.ai and fetches a relative URL, so it sends its own
  // same-origin attestation, while the server only sees localhost:3000.
  const allowed = rejectCrossOrigin(
    requestWith({
      origin: PROXIED_ORIGIN,
      'sec-fetch-site': 'same-origin',
    })
  )
  assert.equal(allowed, null)
})

test('rejectCrossOrigin keeps blocking foreign origins when sec-fetch-site is absent', () => {
  const blocked = rejectCrossOrigin(requestWith({ origin: 'https://evil.example.com' }))
  assert.ok(blocked)
  assert.equal(blocked!.status, 403)
})
