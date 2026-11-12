import { readLimitedJson, rejectCrossOrigin } from '@/lib/deploy/validate'
import { checkRateLimit, rateLimitedResponse, RATE_LIMITS } from '@/lib/security/rate-limit'
import { guardedFetch, assertAllowlistedHost } from '@/lib/security/ssrf'
export const runtime = 'nodejs'
export async function POST(request: Request) {
  if (rejectCrossOrigin(request)) return Response.json({ error: 'Cross-origin requests are not allowed.' }, { status: 403 })
  const rate = await checkRateLimit(request, RATE_LIMITS.deploy)
  if (!rate.ok) return rateLimitedResponse(rate)
  const token = request.headers.get('x-railway-token')?.trim()
  if (!token || token.length > 1000) return Response.json({ error: 'Railway API token is required.' }, { status: 401 })
  const parsed = await readLimitedJson(request, 16384)
  if (parsed.ok === false) return Response.json({ error: parsed.error }, { status: parsed.status })
  const body: any = parsed.value
  const { serviceId, environmentId } = body || {}
  if (typeof serviceId !== 'string' || serviceId.length < 5 || serviceId.length > 100 || typeof environmentId !== 'string' || environmentId.length < 5 || environmentId.length > 100) return Response.json({ error: 'Existing Railway Service ID and Environment ID are required.' }, { status: 400 })
  const query = 'mutation deploy($serviceId: String!, $environmentId: String!) { serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId) }'
  const response = await guardedFetch(assertAllowlistedHost('https://backboard.railway.com/graphql/v2'), { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables: { serviceId, environmentId } }), cache: 'no-store', signal: AbortSignal.timeout(30000) })
  const data: any = await response.json().catch(() => null)
  if (!response.ok || data?.errors?.length) return Response.json({ error: data?.errors?.[0]?.message || `Railway API returned ${response.status}.` }, { status: response.status || 502 })
  return Response.json({ id: data?.data?.serviceInstanceDeployV2 || null, message: 'Railway deployment triggered for the service’s connected source. Push workspace changes to GitHub first.' }, { headers: { 'Cache-Control': 'no-store' } })
}
