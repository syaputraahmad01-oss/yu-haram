import { readLimitedJson, rejectCrossOrigin, validateDeploymentFiles } from '@/lib/deploy/validate'
import { checkRateLimit, rateLimitedResponse, RATE_LIMITS } from '@/lib/security/rate-limit'
import { guardedFetch, assertAllowlistedHost } from '@/lib/security/ssrf'

export const runtime = 'nodejs'
export async function POST(request: Request) {
  if (rejectCrossOrigin(request)) return Response.json({ error: 'Cross-origin requests are not allowed.' }, { status: 403 })
  const rate = await checkRateLimit(request, RATE_LIMITS.deploy)
  if (!rate.ok) return rateLimitedResponse(rate)
  const token = request.headers.get('x-vercel-token')?.trim()
  if (!token || token.length > 500) return Response.json({ error: 'Vercel token is required.' }, { status: 401 })
  const parsed = await readLimitedJson(request, 15_000_000)
  if (parsed.ok === false) return Response.json({ error: parsed.error }, { status: parsed.status })
  const body: any = parsed.value
  const { projectId, projectName, files, target } = body || {}
  if (typeof projectId !== 'string' || !projectId.trim() || projectId.length > 200) return Response.json({ error: 'Vercel Project ID is required. Create or link a project in Vercel first.' }, { status: 400 })
  if (typeof projectName !== 'string' || !/^[a-z0-9][a-z0-9-]{0,99}$/i.test(projectName)) return Response.json({ error: 'Project name must use letters, numbers, and hyphens.' }, { status: 400 })
  const validation = validateDeploymentFiles(files)
  if (!validation.valid) return Response.json({ error: validation.error || 'Invalid deployment files.' }, { status: 400 })
  const payload = { name: projectName, project: projectId, target: target === 'preview' ? 'preview' : 'production', files: Object.entries(files).map(([file, data]) => ({ file, data: Buffer.from(String(data), 'utf8').toString('base64'), encoding: 'base64' })), version: 2 }
  const response = await guardedFetch(assertAllowlistedHost('https://api.vercel.com/v13/deployments'), { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload), cache: 'no-store', signal: AbortSignal.timeout(30000) })
  const data = await response.json().catch(() => null)
  if (!response.ok) return Response.json({ error: data?.error?.message || `Vercel API returned ${response.status}.` }, { status: response.status })
  return Response.json({ id: data.id, url: data.url ? `https://${data.url}` : null, readyState: data.readyState, target: payload.target }, { headers: { 'Cache-Control': 'no-store' } })
}
