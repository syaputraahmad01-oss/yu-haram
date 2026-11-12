/**
 * YUHA ARCHITECTURE FOUNDATION 1: AI Orchestrator & Repair Loop
 * Controls the entire application lifecycle from prompt to verified completion.
 * Dispatches multi-file, multi-step work orders through planner, coder, reviewer, and repair phases.
 */

import type { WorkOrder, VerificationReport } from '@/types'

export type OrchestrationPhase =
  | 'idle'
  | 'ambiguity_check'
  | 'blueprint_planning'
  | 'work_orders_scheduling'
  | 'code_generation'
  | 'deterministic_repair'
  | 'verification'
  | 'independent_review'
  | 'completed'
  | 'failed'
  | 'paused'

export interface OrchestrationEvent {
  id: string
  timestamp: number
  phase: OrchestrationPhase
  message: string
  details?: Record<string, unknown>
}

export interface OrchestratorSession {
  sessionId: string
  projectId: string
  userPrompt: string
  phase: OrchestrationPhase
  activeWorkOrderIndex: number
  workOrders: WorkOrder[]
  events: OrchestrationEvent[]
  maxRepairRetries: number
  repairAttempts: number
  verificationHistory: VerificationReport[]
  isPaused: boolean
  createdAt: number
  updatedAt: number
}

export class YuhaOrchestrator {
  private session: OrchestratorSession

  constructor(projectId: string, userPrompt: string, maxRepairRetries = 3) {
    const now = Date.now()
    this.session = {
      sessionId: 'orch-' + now + '-' + Math.random().toString(36).slice(2, 8),
      projectId,
      userPrompt,
      phase: 'idle',
      activeWorkOrderIndex: 0,
      workOrders: [],
      events: [],
      maxRepairRetries,
      repairAttempts: 0,
      verificationHistory: [],
      isPaused: false,
      createdAt: now,
      updatedAt: now,
    }
    this.logEvent('idle', 'YUHA Orchestrator session initialized')
  }

  public getSession(): Readonly<OrchestratorSession> {
    return { ...this.session }
  }

  public logEvent(phase: OrchestrationPhase, message: string, details?: Record<string, unknown>): OrchestrationEvent {
    const event: OrchestrationEvent = {
      id: 'evt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      timestamp: Date.now(),
      phase,
      message,
      details,
    }
    this.session.phase = phase
    this.session.updatedAt = Date.now()
    this.session.events.push(event)
    return event
  }

  public setWorkOrders(workOrders: WorkOrder[]): void {
    this.session.workOrders = [...workOrders]
    this.logEvent(
      'work_orders_scheduling',
      `Scheduled ${workOrders.length} structured work orders for execution`,
      { count: workOrders.length }
    )
  }

  public advancePhase(nextPhase: OrchestrationPhase, reason: string): void {
    if (this.session.isPaused && nextPhase !== 'paused') {
      throw new Error('Cannot advance phase while orchestrator session is paused')
    }
    this.logEvent(nextPhase, reason)
  }

  public pause(): void {
    this.session.isPaused = true
    this.advancePhase('paused', 'User requested orchestration pause')
  }

  public resume(): void {
    if (!this.session.isPaused) return
    this.session.isPaused = false
    this.advancePhase('code_generation', 'Session resumed from pause')
  }

  public recordVerification(report: VerificationReport): boolean {
    this.session.verificationHistory.push(report)
    const passed = report.overallStatus === 'Passed'

    if (passed) {
      this.advancePhase('completed', 'All acceptance criteria and verification levels passed with proof')
      return true
    }

    this.session.repairAttempts++
    if (this.session.repairAttempts >= this.session.maxRepairRetries) {
      this.advancePhase(
        'failed',
        `Repair loop exceeded maximum allowed budget (${this.session.maxRepairRetries} retries). Execution halted safely to prevent token exhaustion.`
      )
      return false
    }

    this.advancePhase(
      'deterministic_repair',
      `Verification failed (${report.overallStatus}). Initiating controlled repair attempt ${this.session.repairAttempts} of ${this.session.maxRepairRetries}`
    )
    return false
  }

  public canRetryRepair(): boolean {
    return this.session.repairAttempts < this.session.maxRepairRetries && !this.session.isPaused
  }
}
