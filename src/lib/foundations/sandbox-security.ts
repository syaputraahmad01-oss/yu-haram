/**
 * YUHA ARCHITECTURE FOUNDATION 15: Sandboxed Execution & Security Isolation Layer
 * Strictly separates the Trusted Control Plane from the Untrusted Execution Plane.
 * Enforces path traversal prevention, lifecycle script blocks (--ignore-scripts),
 * SSRF and private network access guards, and sandboxed preview isolation.
 */

export interface SecurityPolicyCheckResult {
  allowed: boolean
  violation?: string
  sanitizedValue?: string
}

export class SandboxSecurityLayer {
  /**
   * Validates and normalizes relative file paths, rejecting any path traversal or escapes
   */
  public static validatePath(rawPath: string): SecurityPolicyCheckResult {
    if (typeof rawPath !== 'string' || !rawPath.trim()) {
      return { allowed: false, violation: 'Path must be a non-empty string' }
    }
    const value = rawPath.trim()
    if (value.includes('\0') || /[\u0000-\u001f]/.test(value)) {
      return { allowed: false, violation: 'Control character or null byte detected in path' }
    }
    if (value.startsWith('/') || value.startsWith('\\') || /^[a-zA-Z]:/.test(value)) {
      return { allowed: false, violation: 'Absolute paths are forbidden' }
    }
    const normalized = value.replace(/\\/g, '/')
    const parts = normalized.split('/')
    if (parts.some(part => !part || part === '.' || part === '..' || /^\.+$/.test(part))) {
      return { allowed: false, violation: 'Invalid or traversing path segment detected' }
    }
    return { allowed: true, sanitizedValue: parts.join('/') }
  }

  /**
   * Validates shell / npm commands, enforcing --ignore-scripts on installations
   */
  public static validateNpmCommand(commandStr: string): SecurityPolicyCheckResult {
    const trimmed = commandStr.trim()
    if (!trimmed) return { allowed: false, violation: 'Empty command' }

    // Check for shell injection operators
    if (/[\r\n;&|<>`$]/.test(trimmed)) {
      return { allowed: false, violation: 'Shell chaining, redirection, or backtick injection detected' }
    }

    // Must start with npm
    if (!trimmed.startsWith('npm ')) {
      return { allowed: false, violation: 'Only npm execution is permitted in sandbox' }
    }

    // If install or add, check for lifecycle script risk
    if (/\b(?:install|i|add|ci)\b/.test(trimmed) && !trimmed.includes('--ignore-scripts')) {
      // Suggest/require safe command
      return {
        allowed: true,
        sanitizedValue: `${trimmed} --ignore-scripts`,
      }
    }

    return { allowed: true, sanitizedValue: trimmed }
  }

  /**
   * Checks network egress targets to prevent SSRF against internal/cloud metadata addresses
   */
  public static validateNetworkEgress(targetUrl: string): SecurityPolicyCheckResult {
    try {
      const url = new URL(targetUrl)
      if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        return { allowed: false, violation: 'Only HTTP(S) network egress is permitted' }
      }
      if (url.username || url.password) {
        return { allowed: false, violation: 'Credentials embedded in network URLs are forbidden' }
      }
      const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
      if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname === 'metadata.google.internal') {
        return { allowed: false, violation: 'Local hostnames and cloud metadata services are blocked' }
      }
      // IPv4 literal checks. DNS names are not resolved here, so DNS rebinding/private resolution
      // must additionally be prevented by the actual network sandbox/proxy.
      const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
      if (ipv4) {
        const octets = ipv4.slice(1).map(Number)
        if (octets.some(part => part > 255)) return { allowed: false, violation: 'Invalid IPv4 address' }
        const [a, b] = octets
        if (a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) {
          return { allowed: false, violation: 'Private, loopback, link-local, or reserved IPv4 egress is blocked' }
        }
      }
      // IPv6 loopback, unspecified, unique-local, link-local, and IPv4-mapped private forms.
      if (hostname.includes(':')) {
        if (hostname === '::' || hostname === '::1' || /^::ffff:/i.test(hostname) || /^f[cd][0-9a-f]{2}:/i.test(hostname) || /^fe[89ab][0-9a-f]:/i.test(hostname)) {
          return { allowed: false, violation: 'Private, loopback, link-local, or IPv4-mapped IPv6 egress is blocked' }
        }
      }
      return { allowed: true, sanitizedValue: url.toString() }
    } catch {
      return { allowed: false, violation: 'Invalid URL format for network egress check' }
    }
  }
}
