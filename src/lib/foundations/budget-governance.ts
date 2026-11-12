/**
 * YUHA ARCHITECTURE FOUNDATION 14: Free-Tier Budget Governance & Execution Circuit Breaker
 * Request-scoped guard only: callers create a FRESH manager per HTTP request
 * (`new BudgetGovernanceManager(...)` at the top of the route handler), so all
 * counters and limits apply WITHIN a single request and never accumulate
 * across requests. Token numbers are character-based ESTIMATES per request
 * only — this is not a billing meter, not a cross-request cost limiter, and
 * not a distributed quota service.
 */

export interface BudgetStatus {
  totalTokensUsed: number
  totalRequests: number
  consecutiveFailures: number
  isCircuitBreakerTripped: boolean
  tripReason?: string
  lastFailureTime?: number
}

export class BudgetGovernanceManager {
  private totalTokensUsed = 0
  private totalRequests = 0
  private consecutiveFailures = 0
  private isCircuitBreakerTripped = false
  private tripReason?: string
  private lastFailureTime?: number
  private readonly maxConsecutiveFailures: number
  private readonly maxTokensPerSession: number

  constructor(maxConsecutiveFailures = 4, maxTokensPerSession = 500_000) {
    if (!Number.isSafeInteger(maxConsecutiveFailures) || maxConsecutiveFailures < 1) {
      throw new RangeError('maxConsecutiveFailures must be a positive safe integer')
    }
    if (!Number.isSafeInteger(maxTokensPerSession) || maxTokensPerSession < 1) {
      throw new RangeError('maxTokensPerSession must be a positive safe integer')
    }
    this.maxConsecutiveFailures = maxConsecutiveFailures
    this.maxTokensPerSession = maxTokensPerSession
  }

  /** Reserve an estimated token amount for this request before dispatching a model request. */
  public recordRequest(tokensEstimated: number): void {
    if (this.isCircuitBreakerTripped) {
      throw new Error(`Circuit breaker is TRIPPED: ${this.tripReason}. Reset required before continuing.`)
    }
    if (!Number.isSafeInteger(tokensEstimated) || tokensEstimated < 0) {
      throw new RangeError('tokensEstimated must be a non-negative safe integer')
    }
    const projectedTokens = this.totalTokensUsed + tokensEstimated
    if (!Number.isSafeInteger(projectedTokens) || projectedTokens > this.maxTokensPerSession) {
      this.trip(`Per-request token estimate exceeded (${projectedTokens} / ${this.maxTokensPerSession})`)
      throw new Error(`Per-request token estimate exceeded (${projectedTokens} / ${this.maxTokensPerSession})`)
    }
    this.totalRequests++
    this.totalTokensUsed = projectedTokens
  }

  public recordSuccess(): void {
    this.consecutiveFailures = 0
  }

  public recordFailure(reason: string): boolean {
    this.consecutiveFailures++
    this.lastFailureTime = Date.now()
    if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
      this.trip(`Exceeded maximum consecutive error threshold (${this.consecutiveFailures} errors). Reason: ${String(reason).slice(0, 500)}`)
      return true
    }
    return false
  }

  public trip(reason: string): void {
    this.isCircuitBreakerTripped = true
    this.tripReason = String(reason).slice(0, 500) || 'Unspecified circuit-breaker reason'
  }

  /** Reset the breaker only; this request's usage counters intentionally remain unchanged. */
  public reset(): void {
    this.consecutiveFailures = 0
    this.isCircuitBreakerTripped = false
    this.tripReason = undefined
  }

  public getStatus(): BudgetStatus {
    return {
      totalTokensUsed: this.totalTokensUsed,
      totalRequests: this.totalRequests,
      consecutiveFailures: this.consecutiveFailures,
      isCircuitBreakerTripped: this.isCircuitBreakerTripped,
      tripReason: this.tripReason,
      lastFailureTime: this.lastFailureTime,
    }
  }
}
