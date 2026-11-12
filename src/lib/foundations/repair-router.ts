/**
 * YUHA ARCHITECTURE FOUNDATION 2: Error-Aware Repair Router
 * Classifies failure modes into distinct technical categories before choosing repair strategies.
 * Distinguishes between provider rate limits, network timeouts, syntax/type faults, build errors,
 * runtime exceptions, and security violations.
 */

export type ErrorCategory =
  | 'provider'
  | 'syntax'
  | 'type'
  | 'build'
  | 'runtime'
  | 'dependency'
  | 'configuration'
  | 'integration'
  | 'security'
  | 'deployment'

export type RepairStrategy =
  | 'deterministic_fix'
  | 'model_reprompt_with_diagnostics'
  | 'install_missing_dependency'
  | 'provider_fallback'
  | 'circuit_break'
  | 'user_intervention_required'

export interface ClassifiedError {
  id: string
  rawMessage: string
  category: ErrorCategory
  source: 'provider' | 'compiler' | 'runtime' | 'sandbox' | 'deployer'
  rootCause: string
  strategy: RepairStrategy
  suggestedAction: string
  timestamp: number
  metadata?: Record<string, unknown>
}

export function classifyError(raw: unknown, _context?: { provider?: string; file?: string }): ClassifiedError {
  const message = typeof raw === 'string' ? raw : raw instanceof Error ? raw.message : JSON.stringify(raw)
  const now = Date.now()
  const id = 'err-' + now + '-' + Math.random().toString(36).slice(2, 6)

  // 1. Provider & Network Errors (429, 500, 503, Quota, Timeout)
  if (/(?:429|quota|rate limit|RESOURCE_EXHAUSTED|credits exhausted)/i.test(message)) {
    return {
      id,
      rawMessage: message,
      category: 'provider',
      source: 'provider',
      rootCause: 'Provider rate limit or quota exhaustion reached',
      strategy: 'provider_fallback',
      suggestedAction: 'Switch to backup free-tier provider or back off gracefully',
      timestamp: now,
    }
  }

  if (/(?:ETIMEDOUT|timeout|aborted|ECONNRESET|network error|fetch failed)/i.test(message)) {
    return {
      id,
      rawMessage: message,
      category: 'provider',
      source: 'provider',
      rootCause: 'Transient network failure or upstream provider timeout',
      strategy: 'model_reprompt_with_diagnostics',
      suggestedAction: 'Retry request with exponential backoff and reduced context size',
      timestamp: now,
    }
  }

  // 2. Security Violations
  if (/(?:directory traversal|cross-site|forbidden path|blocked package|malicious command|ssrf|secret leak)/i.test(message)) {
    return {
      id,
      rawMessage: message,
      category: 'security',
      source: 'sandbox',
      rootCause: 'Security sandbox isolation policy breach detected',
      strategy: 'circuit_break',
      suggestedAction: 'Block offending operation immediately and log incident in audit ledger',
      timestamp: now,
    }
  }

  // 3. Dependency Errors
  if (/(?:cannot find module|module not found|err_module_not_found|package [^ ]+ is not installed)/i.test(message)) {
    const pkgMatch = message.match(/(?:module|package) ['"]?([@a-z0-9_.-]+)['"]?/i)
    const pkgName = pkgMatch?.[1]
    return {
      id,
      rawMessage: message,
      category: 'dependency',
      source: 'compiler',
      rootCause: `Missing required package or unresolved import: ${pkgName || 'unknown'}`,
      strategy: 'install_missing_dependency',
      suggestedAction: `Validate package specifier and install ${pkgName || 'missing package'} with --ignore-scripts`,
      timestamp: now,
      metadata: { missingPackage: pkgName },
    }
  }

  // 4. Type Errors
  if (/(?:ts\(\d+\)|type '[^']+' is not assignable|property '[^']+' does not exist)/i.test(message)) {
    return {
      id,
      rawMessage: message,
      category: 'type',
      source: 'compiler',
      rootCause: 'TypeScript strict type mismatch or missing property definition',
      strategy: 'model_reprompt_with_diagnostics',
      suggestedAction: 'Send focused compiler diagnostic to Coder role with relevant file interfaces',
      timestamp: now,
    }
  }

  // 5. Syntax Errors
  if (/(?:SyntaxError|unexpected token|unterminated string|unclosed tag|jsx expression)/i.test(message)) {
    return {
      id,
      rawMessage: message,
      category: 'syntax',
      source: 'compiler',
      rootCause: 'Malformed code syntax, unclosed brackets, or invalid JSX',
      strategy: 'deterministic_fix',
      suggestedAction: 'Attempt deterministic AST repair before spending model tokens',
      timestamp: now,
    }
  }

  // 6. Build & Configuration Errors
  if (/(?:vite: not found|failed to build|build error|postcss error|tsconfig error)/i.test(message)) {
    return {
      id,
      rawMessage: message,
      category: 'build',
      source: 'compiler',
      rootCause: 'Build toolchain failure or bundler configuration mismatch',
      strategy: 'model_reprompt_with_diagnostics',
      suggestedAction: 'Check bundler config, dependencies, and entry point files',
      timestamp: now,
    }
  }

  // Default: Runtime Error
  return {
    id,
    rawMessage: message,
    category: 'runtime',
    source: 'runtime',
    rootCause: 'Application runtime exception or unhandled promise rejection',
    strategy: 'model_reprompt_with_diagnostics',
    suggestedAction: 'Capture stack trace and feed back to Coder agent with active component state',
    timestamp: now,
  }
}
