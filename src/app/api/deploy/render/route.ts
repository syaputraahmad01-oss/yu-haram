import { readLimitedJson, rejectCrossOrigin } from '@/lib/deploy/validate'
import { checkRateLimit, rateLimitedResponse, RATE_LIMITS } from '@/lib/security/rate-limit'
import { guardedFetch, assertAllowlistedHost } from '@/lib/security/ssrf'
export const runtime = 'nodejs'
export async function POST(request: Request) {
  if (rejectCrossOrigin(request)) return Response.json({ error: 'Cross-origin requests are not allowed.' }, { status: 403 })
  const rate = await checkRateLimit(request, RATE_LIMITS.deploy)
  if (!rate.ok) return rateLimitedResponse(rate)
  const token = request.headers.get('x-render-api-key')?.trim()
  if (!token || token.length > 1000) return Response.json({ error: 'Render API key is required.' }, { status: 401 })
  const parsed = await readLimitedJson(request, 16384)
  if (parsed.ok === false) return Response.json({ error: parsed.error }, { status: parsed.status })
  const body: any = parsed.value
  const { serviceId, clearCache } = body || {}
  if (typeof serviceId !== 'string' || !/^srv-[A-Za-z0-9]+$/.test(serviceId)) return Response.json({ error: 'A valid existing Render service ID (srv-...) is required.' }, { status: 400 })
  const response = await guardedFetch(assertAllowlistedHost(`https://api.render.com/v1/services/${encodeURIComponent(serviceId)}/deploys`), { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ clearCache: clearCache ? 'clear' : 'do_not_clear', deployMode: 'build_and_deploy' }), cache: 'no-store', signal: AbortSignal.timeout(30000) })
  const data: any = await response.json().catch(() => null)
  if (!response.ok) return Response.json({ error: data?.message || `Render API returned ${response.status}.` }, { status: response.status })
  return Response.json({ id: data.id, status: data.status, message: 'Render accepted a deploy of the service’s currently connected source/commit. Push workspace changes to its Git repository first.' }, { headers: { 'Cache-Control': 'no-store' } })
}
