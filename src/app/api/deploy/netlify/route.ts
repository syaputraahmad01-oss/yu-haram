import JSZip from 'jszip'
import { readLimitedJson, rejectCrossOrigin, validateDeploymentFiles } from '@/lib/deploy/validate'
import { checkRateLimit, rateLimitedResponse, RATE_LIMITS } from '@/lib/security/rate-limit'
import { guardedFetch, assertAllowlistedHost } from '@/lib/security/ssrf'
export const runtime = 'nodejs'
export async function POST(request: Request) {
  if (rejectCrossOrigin(request)) return Response.json({ error: 'Cross-origin requests are not allowed.' }, { status: 403 })
  const rate = await checkRateLimit(request, RATE_LIMITS.deploy)
  if (!rate.ok) return rateLimitedResponse(rate)
  const token = request.headers.get('x-netlify-token')?.trim()
  if (!token || token.length > 1000) return Response.json({ error: 'Netlify personal access token is required.' }, { status: 401 })
  const parsed = await readLimitedJson(request, 15_000_000)
  if (parsed.ok === false) return Response.json({ error: parsed.error }, { status: parsed.status })
  const body: any = parsed.value
  const { siteId, files, target } = body || {}
  if (typeof siteId !== 'string' || !/^[a-zA-Z0-9-]{6,100}$/.test(siteId)) return Response.json({ error: 'A valid existing Netlify Site ID is required.' }, { status: 400 })
  const validation = validateDeploymentFiles(files)
  if (!validation.valid) return Response.json({ error: validation.error || 'Invalid deployment files.' }, { status: 400 })
  const zip = new JSZip(); for (const [path, content] of Object.entries(files as Record<string,string>)) zip.file(path, content)
  const archive = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })
  const url = new URL(`https://api.netlify.com/api/v1/sites/${encodeURIComponent(siteId)}/deploys`)
  if (target === 'draft') url.searchParams.set('draft', 'true')
  assertAllowlistedHost(url)
  const response = await guardedFetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/zip' }, body: new Uint8Array(archive), cache: 'no-store', signal: AbortSignal.timeout(60000) })
  const data: any = await response.json().catch(() => null)
  if (!response.ok) return Response.json({ error: data?.message || `Netlify API returned ${response.status}.` }, { status: response.status })
  return Response.json({ id: data.id, state: data.state, url: data.deploy_url || data.ssl_url || data.url || null, message: 'Netlify accepted the ZIP deployment. Confirm its final state in Netlify.' }, { headers: { 'Cache-Control': 'no-store' } })
}
