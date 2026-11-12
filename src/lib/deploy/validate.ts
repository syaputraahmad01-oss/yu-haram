import { NextRequest, NextResponse } from 'next/server'
import { isPathSafe } from '@/lib/utils/file-helpers'

const MAX_FILES = 500
const MAX_FILE_BYTES = 1_000_000
const MAX_TOTAL_BYTES = 15_000_000

export function rejectCrossOrigin(request: Request | NextRequest): NextResponse | null {
  const secFetchSite = request.headers.get('sec-fetch-site')
  if (secFetchSite === 'cross-site') {
    return NextResponse.json({ error: 'Cross-origin request rejected' }, { status: 403 })
  }
  // Fetch Metadata is the browser's own attestation that this request originated from the
  // same origin it was served on. It cannot be forged by web content, and it stays valid
  // even when a reverse proxy rewrites the Host so Origin no longer matches request.url.
  // Non-browser clients could spoof it, but they can already omit the Origin header, so
  // this adds no new attack surface while keeping the app usable behind preview proxies.
  if (secFetchSite === 'same-origin') return null
  const origin = request.headers.get('origin')
  if (!origin) return null

  let originUrl: URL
  try {
    originUrl = new URL(origin)
  } catch {
    return NextResponse.json({ error: 'Invalid origin header' }, { status: 400 })
  }

  // The app may be served behind a TLS-terminating reverse proxy (e.g. the preview
  // gateway or the deploy platforms). In that case `request.url` carries the internal
  // upstream host (localhost:3000) instead of the public host the browser actually
  // visited, so an Origin match must also consider the forwarded host/proto headers.
  // Browsers cannot forge Origin together with these forwarded headers, so CSRF
  // protection is preserved: a malicious page on another host still fails the match.
  const allowedOrigins = new Set<string>()
  const addCandidate = (candidate: string) => {
    try { allowedOrigins.add(new URL(candidate).origin) } catch { /* ignore malformed candidates */ }
  }
  addCandidate(request.url)

  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || ''
  const forwardedHosts = (request.headers.get('x-forwarded-host') ?? '')
    .split(',')
    .map(host => host.trim())
    .filter(Boolean)
  const hostHeader = request.headers.get('host') ?? ''

  for (const host of [...forwardedHosts, hostHeader]) {
    if (!host) continue
    if (forwardedProto) addCandidate(`${forwardedProto}://${host}`)
    // Proxies that terminate TLS without forwarding the proto header still serve HTTPS.
    addCandidate(`https://${host}`)
    addCandidate(`http://${host}`)
  }

  if (!allowedOrigins.has(originUrl.origin)) {
    return NextResponse.json({ error: 'Cross-origin request rejected' }, { status: 403 })
  }
  return null
}

/** Validate the untrusted workspace file map before any AI or deployment processing. */
export function validateWorkspaceFileMap(files: unknown): { valid: true } | { valid: false; error: string } {
  if (typeof files !== 'object' || files === null || Array.isArray(files)) {
    return { valid: false, error: 'Project files must be a path-to-text map.' }
  }
  const entries = Object.entries(files as Record<string, unknown>)
  if (entries.length > MAX_FILES) return { valid: false, error: `Project exceeds the ${MAX_FILES}-file limit.` }
  let totalBytes = 0
  const encoder = new TextEncoder()
  for (const [filePath, content] of entries) {
    if (filePath.length > 240 || !isPathSafe(filePath)) {
      return { valid: false, error: `Project contains an invalid file path: ${filePath.slice(0, 80)}` }
    }
    if (typeof content !== 'string') return { valid: false, error: `Project file ${filePath} must contain text.` }
    const size = encoder.encode(content).byteLength
    if (size > MAX_FILE_BYTES) return { valid: false, error: `Project file ${filePath} exceeds the 1 MB limit.` }
    totalBytes += size
    if (totalBytes > MAX_TOTAL_BYTES) return { valid: false, error: 'Project files exceed the 15 MB aggregate limit.' }
  }
  return { valid: true }
}

/** Files that must never be included in a user-triggered deployment archive. */
export function isForbiddenDeploymentPath(filePath: string): boolean {
  if (!filePath || filePath.length > 240 || filePath.includes('\0')) return true
  if (filePath.startsWith('/') || filePath.startsWith('\\') || /^[a-zA-Z]:/.test(filePath)) return true
  if (filePath.includes('\\')) return true

  const segments = filePath.split('/')
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) return true
  if (segments.some(segment => ['.git', '.ssh', '.kube', '.azure', '.docker'].includes(segment.toLowerCase()))) return true
  if (segments.some(segment => segment.toLowerCase() === '.aws')) return true
  if (segments.some((segment, index) => segment.toLowerCase() === '.config' && segments[index + 1]?.toLowerCase() === 'gcloud')) return true

  const normalized = filePath.toLowerCase()
  const base = segments[segments.length - 1].toLowerCase()
  // Permit only the explicitly safe template, never real dotenv files.
  if (/(^|\/)\.env(?:\.|$)/i.test(normalized) && base !== '.env.example') return true
  if (/(^|\/)(?:\.npmrc|\.pypirc|\.netrc|credentials(?:\.json)?|secrets?\.json|service-account(?:\.json)?|firebase-adminsdk[^/]*\.json|\.aws\/credentials|application_default_credentials\.json)$/i.test(normalized)) return true
  if (/(?:^|\/)(?:id_rsa|id_ed25519|known_hosts)$/i.test(normalized)) return true
  if (/\.(?:pem|key|p12|pfx|keystore)$/i.test(base)) return true
  return false
}

export function validateDeploymentFiles(files: unknown): { valid: boolean; error?: string } {
  if (typeof files !== 'object' || files === null || Array.isArray(files)) {
    return { valid: false, error: 'Files payload must be a key-value map' }
  }
  const entries = Object.entries(files as Record<string, unknown>)
  if (entries.length === 0) return { valid: false, error: 'Cannot deploy an empty workspace' }
  if (entries.length > MAX_FILES) return { valid: false, error: `Workspace exceeds the ${MAX_FILES}-file deployment limit` }

  let totalBytes = 0
  for (const [filePath, content] of entries) {
    if (isForbiddenDeploymentPath(filePath)) {
      return { valid: false, error: `Deployment contains a forbidden or invalid path: ${filePath}` }
    }
    if (typeof content !== 'string') {
      return { valid: false, error: `File content for ${filePath} must be a string` }
    }
    const size = new TextEncoder().encode(content).byteLength
    if (size > MAX_FILE_BYTES) return { valid: false, error: `File ${filePath} exceeds the 1 MB deployment limit` }
    totalBytes += size
    if (totalBytes > MAX_TOTAL_BYTES) return { valid: false, error: 'Workspace exceeds the 15 MB deployment limit' }
  }
  return { valid: true }
}

export type LimitedJsonResult =
  | { ok: true; value: unknown }
  | { ok: false; status: 400 | 413; error: string }

/** Read JSON with an enforced byte limit before parsing, including when Content-Length is absent. */
export async function readLimitedJson(request: Request, maxBytes: number): Promise<LimitedJsonResult> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    return { ok: false, status: 400, error: 'Invalid request size limit.' }
  }
  const contentLength = request.headers.get('content-length')
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) return { ok: false, status: 400, error: 'Invalid Content-Length header.' }
    if (Number(contentLength) > maxBytes) return { ok: false, status: 413, error: `Request body exceeds the ${maxBytes}-byte limit.` }
  }
  if (!request.body) return { ok: false, status: 400, error: 'Request body is required.' }

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > maxBytes) {
        await reader.cancel('Request body size limit exceeded').catch(() => undefined)
        return { ok: false, status: 413, error: `Request body exceeds the ${maxBytes}-byte limit.` }
      }
      chunks.push(value)
    }
  } catch {
    return { ok: false, status: 400, error: 'Unable to read request body.' }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  let raw: string
  try { raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch {
    return { ok: false, status: 400, error: 'Request body must be valid UTF-8.' }
  }
  try { return { ok: true, value: JSON.parse(raw) as unknown } } catch {
    return { ok: false, status: 400, error: 'Invalid JSON.' }
  }
}
