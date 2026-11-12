import type { ProviderType } from '@/types'
import { isPathSafe } from '@/lib/utils/file-helpers'

export type CollaborationMode = 'economy' | 'balanced' | 'max'
export interface ProviderRoles {
  planner: ProviderType
  coder: ProviderType
  reviewer: ProviderType | null
  additional: ProviderType[]
}
const providerOrder: ProviderType[] = ['gemini', 'groq', 'openrouter']

/**
 * Build the provider key headers for /api/orchestrate.
 *
 * The orchestrator resolves supporting roles from the three core providers, but
 * the PRIMARY model may be any configured provider (kimi, qwen, ollama...).
 * The original header builder only sent keys for the core trio, so a user with
 * a kimi/qwen/ollama primary got a false 401 "Add your API key in Settings"
 * even though the key was saved. Always include the active provider's key.
 */
export function buildOrchestrationHeaders(
  getApiKey: (provider: ProviderType) => string,
  activeProvider: ProviderType
): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const providers = new Set<ProviderType>([...providerOrder, activeProvider])
  for (const provider of providers) {
    const providerKey = getApiKey(provider)
    if (providerKey) headers[`x-yuha-key-${provider}`] = providerKey
  }
  return headers
}

/** Select distinct configured providers for the requested workflow without inventing model IDs. */
export function resolveProviderRoles(primary: ProviderType, configured: ProviderType[], mode: CollaborationMode): ProviderRoles {
  if (mode === 'economy') return { planner: primary, coder: primary, reviewer: null, additional: [] }
  const available = providerOrder.filter(provider => provider !== primary && configured.includes(provider))
  const planner = configured.includes('gemini') && primary !== 'gemini' ? 'gemini' : (available[0] ?? primary)
  if (mode !== 'max') return { planner, coder: primary, reviewer: null, additional: planner === primary ? [] : [planner] }
  const reviewer = configured.includes('openrouter') && primary !== 'openrouter' && planner !== 'openrouter'
    ? 'openrouter'
    : (available.find(provider => provider !== planner) ?? null)
  return { planner, coder: primary, reviewer, additional: [...new Set([planner, ...(reviewer ? [reviewer] : [])])].filter(provider => provider !== primary) }
}

export interface ProjectContextResult {
  context: string
  omittedCount: number
  includedFiles: string[]
}

/** Regex patterns for credentials and secrets to redact before sending to AI */
const SECRET_PATTERNS = [
  /AIza[0-9A-Za-z-_]{30,45}/g, // Google API Key
  /\bsk-(?:or-v1-|proj-)?[A-Za-z0-9_-]{24,}\b/g, // OpenAI and OpenRouter API keys
  /gsk_[a-zA-Z0-9]{32,64}/g, // Groq API key
  /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36}/g, // GitHub Token
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, // Slack tokens
  /\bnpm_[A-Za-z0-9]{30,}\b/g, // npm access tokens
  /\bya29\.[A-Za-z0-9_-]{20,}\b/g, // Google OAuth access tokens
  /AKIA[0-9A-Z]{16}/g, // AWS Access Key
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, // Private keys
]

export function redactSecrets(content: string): string {
  let redacted = content
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, '[REDACTED_SECRET]')
  }
  return redacted
}

export function isSensitiveFile(path: string): boolean {
  if (typeof path !== 'string' || !isPathSafe(path)) return true
  const normalized = path.replace(/\\/g, '/').toLowerCase()
  const segments = normalized.split('/')
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) return true
  const base = segments[segments.length - 1] || ''
  // Permit only the explicit, non-secret template.
  if (base === '.env.example') return false
  if (segments.some(segment => ['.git', '.ssh', '.aws', '.docker', '.kube', '.azure', '.terraform', '.vercel', '.wrangler'].includes(segment))) return true
  if (segments.some((segment, index) => segment === '.config' && segments[index + 1] === 'gcloud')) return true
  if (/(^|\/)\.env(?:$|\.)/i.test(normalized)) return true
  if (/^(?:\.npmrc|\.pypirc|\.netrc|\.dockercfg|\.git-credentials|\.envrc)$/.test(base)) return true
  if (/(?:credentials?|secrets?|service-account|firebase-adminsdk|application_default_credentials)(?:[^/]*)(?:\.json)?$/i.test(base)) return true
  if (/^(?:id_rsa|id_ed25519|id_ecdsa|known_hosts|authorized_keys)$/.test(base)) return true
  if (/\.(?:pem|key|p12|pfx|keystore|jks|mobileprovision)$/i.test(base)) return true
  if (/^(?:terraform\.tfstate(?:\.backup)?|\.terraform\.lock\.hcl)$/i.test(base)) return true
  return false
}

/** Build project context with prioritized file inclusion without partial truncations, excluding secrets. */
export function buildProjectContext(
  files: Record<string, string>,
  limit = 350_000,
  recentlyChanged: string[] = []
): ProjectContextResult {
  // Exclude sensitive files (.env, private keys)
  const safeFileEntries = Object.entries(files).filter(([path]) => !isSensitiveFile(path))
  const allPaths = safeFileEntries.map(([p]) => p).sort()
  const treeList = allPaths.map(p => `- ${p}`).join('\n')
  const header = `PROJECT FILE TREE:\n${treeList}\n\nFILE CONTENTS:\n`

  const isPackageJson = (p: string) => p === 'package.json'
  const isEntry = (p: string) =>
    /^(?:index\.html|app\/layout\.tsx|app\/page\.tsx|src\/main\.(?:tsx|ts|jsx|js)|src\/App\.(?:tsx|jsx)|src\/index\.(?:tsx|ts|jsx|js)|index\.(?:js|ts))$/i.test(p)
  const isRecent = (p: string) => recentlyChanged.includes(p)

  const priorityScore = (p: string): number => {
    if (isPackageJson(p)) return 0
    if (isEntry(p)) return 1
    if (isRecent(p)) return 2
    return 3
  }

  const sortedPaths = [...allPaths].sort((a, b) => {
    const scoreDiff = priorityScore(a) - priorityScore(b)
    if (scoreDiff !== 0) return scoreDiff
    return a.localeCompare(b)
  })

  let currentLength = header.length
  const included: Array<{ path: string; content: string }> = []
  let omittedCount = 0

  for (const path of sortedPaths) {
    const rawContent = files[path] ?? ''
    const content = redactSecrets(rawContent)
    const entryChunk = `--- ${path} ---\n${content}\n\n`
    if (currentLength + entryChunk.length + 60 > limit) {
      omittedCount = sortedPaths.length - included.length
      break
    }
    included.push({ path, content })
    currentLength += entryChunk.length
  }

  let resultContext = header + included.map(item => `--- ${item.path} ---\n${item.content}\n\n`).join('')
  if (omittedCount > 0) {
    resultContext += `[${omittedCount} file dihilangkan]\n`
  }

  return {
    context: resultContext,
    omittedCount,
    includedFiles: included.map(i => i.path),
  }
}
