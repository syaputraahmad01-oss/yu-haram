/**
 * SSRF + DNS rebinding protection for every server-side outbound request.
 *
 * Threat model:
 *  - Any URL that is (directly or indirectly) influenced by request input must
 *    never be able to reach loopback, private, link-local or cloud-metadata
 *    addresses from the server runtime.
 *  - Validating the URL string alone is NOT enforcement: DNS rebinding can make
 *    a public-looking name resolve to 127.0.0.1 (or 169.254.169.254) between
 *    validation and connection. Therefore `guardedFetch` performs its own DNS
 *    resolution, rejects private results, and PINS the validated address on the
 *    actual socket via a custom undici connect lookup. The connection can only
 *    be established to an address this module validated for that exact request.
 *
 * Explicit exceptions:
 *  - The Ollama local runtime is a documented product feature (localhost:11434).
 *    It is allowed only with `allowLoopback: true` and only for loopback hosts —
 *    never for any other private range.
 */

import { Agent, fetch as undiciFetch } from 'undici'
import type { LookupAddress } from 'node:dns'
import { lookup as dnsLookup } from 'node:dns'
import { isIP } from 'node:net'
import type { LookupFunction } from 'node:net'

/* ------------------------------------------------------------------ */
/* Pure IP classification (unit tested)                                */
/* ------------------------------------------------------------------ */

const V4_LOOPBACK = ['127.0.0.0/8']
const V4_PRIVATE = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10']
const V4_LINK_LOCAL = ['169.254.0.0/16'] // includes AWS/GCP metadata 169.254.169.254
const V4_OTHER = [
  '0.0.0.0/8', '192.0.0.0/24', '192.0.2.0/24', '198.18.0.0/15',
  '198.51.100.0/24', '203.0.113.0/24', '224.0.0.0/4', '240.0.0.0/4',
]

function v4ToInt(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let value = 0
  for (const part of parts) {
    const n = Number(part)
    if (!Number.isInteger(n) || n < 0 || n > 255 || !/^\d+$/.test(part)) return null
    value = value * 256 + n
  }
  return value
}

function inCidr4(ip: string, cidr: string): boolean {
  const [base, bitsRaw] = cidr.split('/')
  const bits = Number(bitsRaw)
  const ipInt = v4ToInt(ip)
  const baseInt = v4ToInt(base)
  if (ipInt == null || baseInt == null || !Number.isInteger(bits)) return false
  const mask = bits === 0 ? 0 : (0xFFFFFFFF << (32 - bits)) >>> 0
  return ((ipInt & mask) >>> 0) === ((baseInt & mask) >>> 0)
}

function expandV6(ip: string): string | null {
  if (!ip.includes(':')) return null
  const [head, tail] = ip.split('::')
  const headGroups = head ? head.split(':').filter(Boolean) : []
  const tailGroups = ip.includes('::') && tail !== undefined ? tail.split(':').filter(Boolean) : []
  const missing = 8 - headGroups.length - tailGroups.length
  if (!ip.includes('::') && headGroups.length !== 8) return null
  if (ip.includes('::') && (missing < 0 || missing > 7)) return null
  const groups = ip.includes('::')
    ? [...headGroups, ...Array.from({ length: missing }, () => '0'), ...tailGroups]
    : headGroups
  if (groups.length !== 8 || groups.some(group => !/^[0-9a-fA-F]{1,4}$/.test(group))) return null
  return groups.map(group => group.padStart(4, '0')).join(':')
}

function v6PrefixMatch(ip: string, prefixBits: number, prefixHex: string): boolean {
  const expanded = expandV6(ip)
  const expandedPrefix = expandV6(prefixHex)
  if (!expanded || !expandedPrefix) return false
  const full = expanded.replace(/:/g, '')
  const prefix = expandedPrefix.replace(/:/g, '')
  const bits = Math.ceil(prefixBits / 4)
  return full.slice(0, bits) === prefix.slice(0, bits)
}

/** IPv4 address embedded in an IPv4-mapped IPv6 address, if any. */
function embeddedV4(ip: string): string | null {
  // Dotted-tail form (::ffff:127.0.0.1) is not valid hex, so check it first:
  // expandV6 would reject the whole address before the regex is reached.
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)
  if (dotted) return dotted[1]
  const expanded = expandV6(ip)
  if (!expanded) return null
  if (expanded.startsWith('0000:0000:0000:0000:0000:ffff:')) {
    // expanded form: 0000...ffff aabbccdd in hex groups
    const hex = expanded.replace(/:/g, '').slice(24)
    if (hex.length === 8) {
      const octets = [0, 2, 4, 6].map(offset => parseInt(hex.slice(offset, offset + 2), 16))
      if (octets.every(Number.isFinite)) return octets.join('.')
    }
  }
  return null
}

/**
 * True when the address must never be a fetch target from the server:
 * loopback, RFC1918/CGNAT private, link-local (incl. cloud metadata),
 * unspecified, documentation, benchmark, multicast and reserved ranges.
 */
export function isForbiddenIp(ip: string): boolean {
  const version = isIP(ip)
  if (version === 4) {
    if (V4_LOOPBACK.some(cidr => inCidr4(ip, cidr))) return true
    if (V4_PRIVATE.some(cidr => inCidr4(ip, cidr))) return true
    if (V4_LINK_LOCAL.some(cidr => inCidr4(ip, cidr))) return true
    if (V4_OTHER.some(cidr => inCidr4(ip, cidr))) return true
    return false
  }
  if (version === 6) {
    // Dotted-tail IPv4-compatible form (::127.0.0.1) — deprecated and
    // untrustworthy for egress; blocked outright. (The ::ffff: mapped form is
    // handled by embeddedV4 below, which validates the embedded address.)
    if (/^::\d+\.\d+\.\d+\.\d+$/.test(ip)) return true
    const mapped = embeddedV4(ip)
    if (mapped) return isForbiddenIp(mapped)
    if (ip.toLowerCase() === '::1' || ip.toLowerCase() === '::') return true
    const expanded = expandV6(ip)
    const firstOctet = expanded ? expanded.slice(0, 2) : ''
    if (firstOctet === 'fc' || firstOctet === 'fd') return true // ULA fc00::/7
    if (v6PrefixMatch(ip, 10, 'fe80::')) return true // link-local
    if (v6PrefixMatch(ip, 8, 'ff00::')) return true // multicast
    if (v6PrefixMatch(ip, 32, '2001:db8::')) return true // documentation
    if (v6PrefixMatch(ip, 96, '::ffff:0:0')) return true // IPv4-translated
    // NAT64 64:ff9b::/96: DNS answers in NAT64 form are unrequested aliases;
    // the whole range is blocked for egress regardless of the embedded IPv4
    // (conservative — the embedded address is not authenticated).
    if (v6PrefixMatch(ip, 96, '64:ff9b::')) return true
    // 6to4 2002::/16: embedded IPv4 is bits 17-48 — 2002:7f00:1::1 is 127.0.0.1.
    if (v6PrefixMatch(ip, 16, '2002::')) {
      const hex = expanded?.replace(/:/g, '').slice(4, 12) ?? ''
      if (hex.length === 8) {
        const embedded = [0, 2, 4, 6].map(offset => parseInt(hex.slice(offset, offset + 2), 16)).join('.')
        if (isForbiddenIp(embedded)) return true
      }
      return true
    }
    // Teredo 2001:0::/32 tunnels through public servers but its last 32 bits
    // encode a (obfuscated) client IPv4; block the whole range for egress.
    if (v6PrefixMatch(ip, 32, '2001:0::')) return true
    // Deprecated IPv4-compatible IPv6 (::a.b.c.d, prefix ::/96) — anything
    // here other than :: and ::1 (handled above) is unusable and untrustworthy.
    if (expanded && expanded.startsWith('0000:0000:0000:0000:0000:0000:') && !expanded.startsWith('0000:0000:0000:0000:0000:ffff:')) {
      const tail = expanded.slice('0000:0000:0000:0000:0000:0000:'.length)
      if (/^[0-9a-f]{4}:[0-9a-f]{4}$/.test(tail) && tail !== '0000:0000') return true
    }
    return false
  }
  return true // not parseable as an IP → treat as forbidden
}

const FORBIDDEN_HOSTNAMES = /^(localhost|.*\.localhost|.*\.local|metadata\.google\.internal|metadata|instance-data)$/i

/* ------------------------------------------------------------------ */
/* DNS-resolving, validating lookup                                    */
/* ------------------------------------------------------------------ */

interface LookupEntry { address: string; family: number }

function lookupAll(hostname: string): Promise<LookupEntry[]> {
  return new Promise((resolve, reject) => {
    dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
      if (error) reject(error)
      else resolve(addresses as LookupEntry[])
    })
  })
}

export interface UrlValidationOptions {
  /** Allow loopback hostnames/addresses (Ollama local runtime only). */
  allowLoopback?: boolean
}

export interface ValidatedTarget {
  hostname: string
  /** The address this module validated and that the connection will pin. */
  address: string
  family: 4 | 6
}

/** Validate scheme, literal hosts and all resolved DNS records. */
export async function validateOutboundUrl(rawUrl: string | URL, options: UrlValidationOptions = {}): Promise<ValidatedTarget> {
  const url = rawUrl instanceof URL ? rawUrl : new URL(rawUrl)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Blocked outbound URL scheme: ${url.protocol}`)
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  const literalVersion = isIP(hostname)

  if (FORBIDDEN_HOSTNAMES.test(hostname)) {
    if (!options.allowLoopback) throw new Error(`Blocked outbound host: ${hostname}`)
    return { hostname, address: hostname === 'localhost' ? '127.0.0.1' : hostname, family: hostname === 'localhost' ? 4 : 6 }
  }

  if (literalVersion !== 0) {
    if (isForbiddenIp(hostname)) {
      if (!options.allowLoopback || !/^127\./.test(hostname)) throw new Error(`Blocked outbound address: ${hostname}`)
      return { hostname, address: hostname, family: 4 }
    }
    return { hostname, address: hostname, family: literalVersion as 4 | 6 }
  }

  const entries = await lookupAll(hostname)
  if (!entries.length) throw new Error(`DNS resolution returned no addresses for ${hostname}`)
  for (const entry of entries) {
    if (isForbiddenIp(entry.address) && !(options.allowLoopback && /^127\./.test(entry.address))) {
      throw new Error(`DNS for ${hostname} resolves to a forbidden address (${entry.address}); request blocked.`)
    }
  }
  // Pin the FIRST public address; the socket can only connect to this IP.
  const pinned = entries.find(entry => !isForbiddenIp(entry.address)) ?? entries[0]
  return { hostname, address: pinned.address, family: pinned.family as 4 | 6 }
}

/* ------------------------------------------------------------------ */
/* guardedFetch: validation + address pinning                          */
/* ------------------------------------------------------------------ */

function validatingLookup(_options: UrlValidationOptions): LookupFunction {
  return ((hostname: string, opts: unknown, callback: (error: NodeJS.ErrnoException | null, address?: string | LookupAddress[], family?: number) => void) => {
    void (async () => {
      try {
        const target = await validateOutboundUrl(`http://${hostname}`, { allowLoopback: _options.allowLoopback })
        // Preserve net.connect's contract: address[, family] or entry list.
        const all = await lookupAll(hostname)
        const allowed = all.filter(entry => !isForbiddenIp(entry.address))
        callback(null, allowed.length ? allowed : [{ address: target.address, family: target.family }])
      } catch (error) {
        const err: NodeJS.ErrnoException = new Error(error instanceof Error ? error.message : 'lookup blocked')
        err.code = 'EYUHA_BLOCKED_HOST'
        callback(err)
      }
    })()
  }) as unknown as LookupFunction
}

let publicAgent: Agent | null = null
let loopbackAgent: Agent | null = null
function agentFor(options: UrlValidationOptions): Agent {
  if (options.allowLoopback) {
    loopbackAgent = loopbackAgent ?? new Agent({ connect: { lookup: validatingLookup(options) } })
    return loopbackAgent
  }
  publicAgent = publicAgent ?? new Agent({ connect: { lookup: validatingLookup(options) } })
  return publicAgent
}

export interface GuardedFetchOptions extends Omit<UndiciRequestInitShim, 'body'> {
  /** Permit loopback targets (Ollama local runtime). Default: false. */
  allowLoopback?: boolean
  /** Body accepted in every runtime: string, typed arrays, Blob and FormData. */
  body?: UndiciRequestInitShim['body'] | FormData
}

/** Structural shim so the module type-checks on both Node and Bun without
 *  importing undici's exact RequestInit in public signatures. */
interface UndiciRequestInitShim {
  method?: string
  headers?: Record<string, string> | Headers
  body?: unknown
  redirect?: 'error' | 'follow' | 'manual'
  signal?: AbortSignal | null
  cache?: 'no-store' | 'default'
  timeout?: number
}

/**
 * The ONLY sanctioned way for YUHA server code to call an external HTTP host.
 * - Validates scheme + literal IP + all DNS records (SSRF).
 * - Pins the connection to the validated address via undici connect lookup
 *   (DNS rebinding protection — the socket cannot silently re-resolve).
 * - Redirects are rejected: every redirect is a fresh outbound decision that
 *   must go through validation again, not happen implicitly inside the socket.
 */
export async function guardedFetch(rawUrl: string | URL, init: GuardedFetchOptions = {}): Promise<Response> {
  const { allowLoopback, ...requestInit } = init
  await validateOutboundUrl(rawUrl, { allowLoopback })
  const url = rawUrl instanceof URL ? rawUrl : new URL(rawUrl)
  const agent = agentFor({ allowLoopback })
  return await undiciFetch(url, {
    ...requestInit,
    body: requestInit.body as never,
    redirect: requestInit.redirect ?? 'error',
    dispatcher: agent,
  }) as unknown as Response
}

/* ------------------------------------------------------------------ */
/* Fixed outbound allowlist (defense in depth for known integrations)  */
/* ------------------------------------------------------------------ */

export const OUTBOUND_HOST_ALLOWLIST = [
  'generativelanguage.googleapis.com',
  'api.groq.com',
  'openrouter.ai',
  'api.moonshot.cn',
  'dashscope-intl.aliyuncs.com',
  'api.github.com',
  'api.vercel.com',
  'api.netlify.com',
  'api.render.com',
  'backboard.railway.com',
  'api.cloudflare.com',
] as const

/** For fixed integrations: host must match the allowlist exactly. */
export function assertAllowlistedHost(rawUrl: string | URL): URL {
  const url = rawUrl instanceof URL ? rawUrl : new URL(rawUrl)
  const host = url.hostname
  if (!(OUTBOUND_HOST_ALLOWLIST as readonly string[]).includes(host)) {
    throw new Error(`Host ${host} is not on the YUHA outbound allowlist.`)
  }
  return url
}
