/**
 * YUHA ARCHITECTURE FOUNDATION 5: Capability-Based Model Router
 *
 * This module intentionally contains no baked-in model identifiers, prices, or capability scores.
 * Callers must supply candidates from a current provider catalog and separately measured capability
 * evidence. No active Next.js route currently supplies such benchmark evidence, so this remains a
 * reusable routing primitive rather than an active production router.
 */

import type { ProviderType, ModelTier } from '@/types'

export type TaskType = 'planning' | 'coding' | 'review' | 'repair' | 'json_generation' | 'fast_edit'

export interface ModelCapabilityRecord {
  modelId: string
  provider: ProviderType
  codingScore: number // 1-100; must come from measured evidence, not a model-name guess
  reasoningScore: number // 1-100; must come from measured evidence, not a model-name guess
  contextWindow: number // sourced from the live provider catalog
  tier: ModelTier
  verifiedFree: boolean // explicit pricing/access evidence for this model/account
  isLocal: boolean
}

export class CapabilityBasedModelRouter {
  public static selectBestModelForTask(
    taskType: TaskType,
    candidates: ModelCapabilityRecord[],
    options: { allowPaid?: boolean; preferLocal?: boolean } = {}
  ): ModelCapabilityRecord | null {
    const allowPaid = options.allowPaid === true
    const validCandidates = candidates.filter(record => {
      if (!record || typeof record.modelId !== 'string' || !record.modelId.trim()) return false
      if (!Number.isFinite(record.codingScore) || record.codingScore < 1 || record.codingScore > 100) return false
      if (!Number.isFinite(record.reasoningScore) || record.reasoningScore < 1 || record.reasoningScore > 100) return false
      if (!Number.isSafeInteger(record.contextWindow) || record.contextWindow < 1) return false
      if (options.preferLocal && !record.isLocal) return false
      if (allowPaid) return true
      // Cloud models need explicit verified-free evidence. Local models avoid hosted API billing.
      return record.isLocal && record.tier === 'free'
        || record.verifiedFree && (record.tier === 'free' || record.tier === 'free-tier')
    })

    if (!validCandidates.length) return null

    switch (taskType) {
      case 'planning':
      case 'review':
        return [...validCandidates].sort((a, b) => b.reasoningScore - a.reasoningScore)[0]
      case 'coding':
      case 'repair':
        return [...validCandidates].sort((a, b) => b.codingScore - a.codingScore)[0]
      case 'fast_edit':
        return [...validCandidates].sort((a, b) => Number(b.isLocal) - Number(a.isLocal))[0]
      case 'json_generation':
      default:
        return [...validCandidates].sort((a, b) =>
          (b.reasoningScore + b.codingScore) - (a.reasoningScore + a.codingScore)
        )[0]
    }
  }
}
