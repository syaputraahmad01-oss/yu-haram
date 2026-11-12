import { isForbiddenDeploymentPath, readLimitedJson, rejectCrossOrigin } from '@/lib/deploy/validate'
import { checkRateLimit, rateLimitedResponse, RATE_LIMITS } from '@/lib/security/rate-limit'
import { assertAllowlistedHost, guardedFetch } from '@/lib/security/ssrf'
export const runtime = 'nodejs'
const api = 'https://api.github.com'
async function gh(token: string, path: string, method = 'GET', body?: unknown) {
  // Fixed allowlist host + SSRF-validated, DNS-pinned connection.
  assertAllowlistedHost(`${api}${path}`)
  const res = await guardedFetch(`${api}${path}`, { method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), cache: 'no-store', signal: AbortSignal.timeout(20000) })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.message || `GitHub API returned ${res.status}`)
  return data
}
export async function POST(request: Request) {
  if (rejectCrossOrigin(request)) return Response.json({ error: 'Cross-site requests are not allowed.' }, { status: 403 })
  const rate = await checkRateLimit(request, RATE_LIMITS.githubCommit)
  if (!rate.ok) return rateLimitedResponse(rate)
  const token = request.headers.get('x-github-token')?.trim()
  if (!token || token.length > 500) return Response.json({ error: 'GitHub token is required.' }, { status: 401 })
  const parsed = await readLimitedJson(request, 15_000_000)
  if (parsed.ok === false) return Response.json({ error: parsed.error }, { status: parsed.status })
  const body: any = parsed.value
  const { owner, repo, branch, message, files } = body || {}
  if (![owner, repo, branch, message].every((v: unknown) => typeof v === 'string' && v.trim() && v.length <= 200)) return Response.json({ error: 'Owner, repository, branch, and commit message are required.' }, { status: 400 })
  if (!files || typeof files !== 'object' || Array.isArray(files) || Object.keys(files).length < 1 || Object.keys(files).length > 300 || Object.entries(files).some(([p, v]) => isForbiddenDeploymentPath(p) || typeof v !== 'string' || new TextEncoder().encode(v).byteLength > 1_000_000)) return Response.json({ error: 'Invalid files payload. Limit: 300 text files, 1 MB each.' }, { status: 400 })
  try {
    const prefix = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
    const ref = await gh(token, `${prefix}/git/ref/heads/${encodeURIComponent(branch)}`)
    const parent = await gh(token, `${prefix}/git/commits/${ref.object.sha}`)
    const tree = await gh(token, `${prefix}/git/trees`, 'POST', { base_tree: parent.tree.sha, tree: Object.entries(files).map(([path, content]) => ({ path, mode: '100644', type: 'blob', content })) })
    const commit = await gh(token, `${prefix}/git/commits`, 'POST', { message: message.trim().slice(0, 200), tree: tree.sha, parents: [parent.sha] })
    await gh(token, `${prefix}/git/refs/heads/${encodeURIComponent(branch)}`, 'PATCH', { sha: commit.sha, force: false })
    return Response.json({ success: true, sha: commit.sha, url: commit.html_url, files: Object.keys(files).length }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'GitHub commit failed.' }, { status: 400 }) }
}
