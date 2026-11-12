import { rejectCrossOrigin } from '@/lib/deploy/validate'
import { checkRateLimit, rateLimitedResponse, RATE_LIMITS } from '@/lib/security/rate-limit'
import { assertAllowlistedHost, guardedFetch } from '@/lib/security/ssrf'

export const runtime = 'nodejs'
export async function GET(request: Request) {
  if (rejectCrossOrigin(request)) return Response.json({ error: 'Cross-site requests are not allowed.' }, { status: 403 })
  const rate = await checkRateLimit(request, RATE_LIMITS.githubRepos)
  if (!rate.ok) return rateLimitedResponse(rate)
  const token = request.headers.get('x-github-token')?.trim()
  if (!token || token.length > 500) return Response.json({ error: 'GitHub token is required.' }, { status: 401 })
  const url = assertAllowlistedHost('https://api.github.com/user/repos?sort=updated&per_page=50&affiliation=owner,collaborator')
  const response = await guardedFetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, cache: 'no-store', signal: AbortSignal.timeout(15000) })
  const data = await response.json().catch(() => null)
  if (!response.ok) return Response.json({ error: data?.message || `GitHub request failed (${response.status}).` }, { status: response.status })
  return Response.json({ repositories: Array.isArray(data) ? data.map((repo: any) => ({ id: repo.id, full_name: repo.full_name, private: repo.private, default_branch: repo.default_branch, html_url: repo.html_url })) : [] }, { headers: { 'Cache-Control': 'no-store' } })
}
