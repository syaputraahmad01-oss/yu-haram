import { readLimitedJson, rejectCrossOrigin } from '@/lib/deploy/validate'
import { checkRateLimit, rateLimitedResponse, RATE_LIMITS } from '@/lib/security/rate-limit'
import { guardedFetch, assertAllowlistedHost } from '@/lib/security/ssrf'
export const runtime = 'nodejs'
export async function POST(request: Request) {
  if (rejectCrossOrigin(request)) return Response.json({ error: 'Cross-origin requests are not allowed.' }, { status: 403 })
  const rate = await checkRateLimit(request, RATE_LIMITS.deploy)
  if (!rate.ok) return rateLimitedResponse(rate)
  const token = request.headers.get('x-cloudflare-token')?.trim()
  if (!token || token.length > 1000) return Response.json({ error: 'Cloudflare API token is required.' }, { status: 401 })
  const parsed = await readLimitedJson(request, 16384)
  if (parsed.ok === false) return Response.json({ error: parsed.error }, { status: parsed.status })
  const body: any = parsed.value
  const { accountId, projectName, branch } = body || {}
  if (typeof accountId !== 'string' || !/^[a-f0-9]{32}$/i.test(accountId)) return Response.json({ error: 'A valid Cloudflare account ID is required.' }, { status: 400 })
  if (typeof projectName !== 'string' || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(projectName)) return Response.json({ error: 'Project name must use lowercase letters, numbers, and hyphens.' }, { status: 400 })
  if (typeof branch !== 'string' || !/^[A-Za-z0-9._/-]{1,100}$/.test(branch) || branch.includes('..')) return Response.json({ error: 'A valid Git branch is required.' }, { status: 400 })
  const form = new FormData(); form.set('branch', branch); form.set('commit_dirty', 'false')
  const response = await guardedFetch(assertAllowlistedHost(`https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}/deployments`), { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form, cache: 'no-store', signal: AbortSignal.timeout(45000) })
  const data: any = await response.json().catch(() => null)
  if (!response.ok || data?.success === false) return Response.json({ error: data?.errors?.[0]?.message || `Cloudflare API returned ${response.status}.` }, { status: response.status || 502 })
  const result = data?.result || {}
  return Response.json({ id: result.id, url: result.url || null, status: result.latest_stage?.status || 'queued', message: 'Cloudflare Pages deployment triggered from the connected Git branch. Commit workspace changes to GitHub first.' }, { headers: { 'Cache-Control': 'no-store' } })
}
