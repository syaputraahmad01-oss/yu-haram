/**
 * YUHA ARCHITECTURE FOUNDATION 6: Work Order Protocol
 * Converts user goals into discrete, trackable, and verifiable Work Orders.
 * Supports dependency sorting, topological scheduling, and state transitions.
 */

import type { WorkOrder, WorkOrderStatus, WorkOrderType } from '@/types'

export class WorkOrderManager {
  private orders: Map<string, WorkOrder> = new Map()

  constructor(initialOrders: WorkOrder[] = []) {
    for (const order of initialOrders) {
      this.orders.set(order.id, { ...order })
    }
  }

  public createOrder(params: {
    type: WorkOrderType
    title: string
    objective: string
    scope: string[]
    dependencies?: string[]
    priority?: number
    affectedFiles: string[]
    acceptanceCriteria: string[]
    maxRetries?: number
  }): WorkOrder {
    const id = 'wo-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6)
    const order: WorkOrder = {
      id,
      type: params.type,
      title: params.title,
      objective: params.objective,
      scope: params.scope,
      dependencies: params.dependencies || [],
      priority: params.priority || 1,
      status: 'queued',
      affectedFiles: params.affectedFiles,
      acceptanceCriteria: params.acceptanceCriteria,
      evidence: [],
      retryCount: 0,
      maxRetries: params.maxRetries || 3,
    }
    this.orders.set(id, order)
    return order
  }

  public getOrder(id: string): WorkOrder | undefined {
    return this.orders.get(id)
  }

  public getAllOrders(): WorkOrder[] {
    return Array.from(this.orders.values())
  }

  public updateStatus(id: string, status: WorkOrderStatus, evidenceNote?: string): WorkOrder {
    const order = this.orders.get(id)
    if (!order) throw new Error(`WorkOrder ${id} does not exist`)

    order.status = status
    if (evidenceNote) {
      order.evidence = [...(order.evidence || []), `[${status}] ${evidenceNote} (${new Date().toISOString()})`]
    }
    return { ...order }
  }

  public recordFailure(id: string, error: string): { canRetry: boolean; order: WorkOrder } {
    const order = this.orders.get(id)
    if (!order) throw new Error(`WorkOrder ${id} does not exist`)

    order.retryCount = (order.retryCount || 0) + 1
    order.error = error
    const canRetry = order.retryCount < (order.maxRetries || 3)

    if (canRetry) {
      order.status = 'queued'
      order.evidence = [...(order.evidence || []), `[retry ${order.retryCount}] Re-queued after error: ${error}`]
    } else {
      order.status = 'failed'
      order.evidence = [...(order.evidence || []), `[failed] Max retries (${order.maxRetries}) exceeded: ${error}`]
    }

    return { canRetry, order: { ...order } }
  }

  /**
   * Returns work orders in topological execution order according to their dependencies
   */
  public getExecutableOrders(): WorkOrder[] {
    const orders = Array.from(this.orders.values())
    const completedIds = new Set(orders.filter(o => o.status === 'completed').map(o => o.id))

    // An order is executable if it is queued and all its dependencies are completed
    return orders.filter(o => {
      if (o.status !== 'queued') return false
      return o.dependencies.every(depId => completedIds.has(depId))
    }).sort((a, b) => b.priority - a.priority)
  }
}
