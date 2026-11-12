'use client'
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { StateStorage } from 'zustand/middleware'
import type { ProviderType } from '@/types'
import { DEFAULT_MODEL, DEFAULT_PROVIDER } from '@/lib/constants/models'
import { sanitizeApiKeys, secureSettingsStorage } from '@/lib/store/secureSettingsStorage'
import type { ResearchProviderId } from '@/lib/research/types'

export type CollaborationMode = 'economy' | 'balanced' | 'max'
export type AgentRole = 'planner' | 'coder' | 'reviewer' | 'debugger'

export interface RoleModelConfig {
  provider: ProviderType
  model: string
}

export interface ResearchConfig {
  keys: Partial<Record<ResearchProviderId, string>>
  enabled: Partial<Record<ResearchProviderId, boolean>>
  /** User-ordered search fallback (Master 9.3). */
  order: ResearchProviderId[]
  maxResults: number
  searxngBaseUrl: string
  /** Auto web-research when the prompt needs fresh info (Master 10). */
  autoResearch: boolean
}

interface SettingsState {
  collaborationMode: CollaborationMode
  setCollaborationMode: (mode: CollaborationMode) => void
  apiKeys: Partial<Record<ProviderType, string>>
  activeProvider: ProviderType
  activeModel: string
  roleModels: Partial<Record<AgentRole, RoleModelConfig>>
  allowPaidModels: boolean
  /** One-time consent for the automatic dev/build verification sequence. */
  executionAutoRunConsented: boolean
  setExecutionAutoRunConsented: (consented: boolean) => void
  /** Per-model cost consents (Master Prompt 3.1.9): `provider:model` keys the
   *  user explicitly approved. NOT a blanket switch — each entry unlocks only
   *  that one model. */
  consentedModels: string[]
  setApiKey: (provider: ProviderType, key: string) => void
  removeApiKey: (provider: ProviderType) => void
  setActiveProvider: (provider: ProviderType) => void
  setActiveModel: (model: string) => void
  setRoleModel: (role: AgentRole, provider: ProviderType, model: string) => void
  setAllowPaidModels: (allow: boolean) => void
  consentModel: (provider: ProviderType, model: string) => void
  revokeModelConsent: (provider: ProviderType, model: string) => void
  isModelConsented: (provider: ProviderType, model: string) => boolean
  getApiKey: (provider: ProviderType) => string
  research: ResearchConfig
  setResearchConfig: (patch: Partial<ResearchConfig>) => void
}

export const useSettingsStore = create<SettingsState>()(persist((set, get) => ({
  apiKeys: {},
  activeProvider: DEFAULT_PROVIDER,
  activeModel: DEFAULT_MODEL,
  collaborationMode: 'balanced',
  roleModels: {},
  allowPaidModels: false, // Legacy master preference; per-model consent is the primary gate.
  executionAutoRunConsented: false,
  consentedModels: [],
  research: {
    keys: {},
    enabled: { tavily: true, serpapi: true, searxng: true, duckduckgo: false, brave: true, exa: true },
    order: ['tavily', 'brave', 'serpapi', 'exa', 'searxng', 'duckduckgo'],
    maxResults: 5,
    searxngBaseUrl: '',
    autoResearch: false,
  },

  setCollaborationMode: collaborationMode => set({ collaborationMode }),
  setApiKey: (provider, key) => set(state => ({ apiKeys: { ...state.apiKeys, [provider]: key.trim() } })),
  removeApiKey: provider => set(state => { const apiKeys = { ...state.apiKeys }; delete apiKeys[provider]; return { apiKeys } }),
  setActiveProvider: activeProvider => set({ activeProvider, activeModel: '' }),
  setActiveModel: activeModel => set({ activeModel }),
  setRoleModel: (role, provider, model) => set(state => ({
    roleModels: { ...state.roleModels, [role]: { provider, model } },
  })),
  setAllowPaidModels: allowPaidModels => set({ allowPaidModels }),
  setExecutionAutoRunConsented: executionAutoRunConsented => set({ executionAutoRunConsented }),
  consentModel: (provider, model) => set(state => {
    const key = `${provider}:${model}`
    return { consentedModels: state.consentedModels.includes(key) ? state.consentedModels : [...state.consentedModels, key] }
  }),
  revokeModelConsent: (provider, model) => set(state => {
    const key = `${provider}:${model}`
    return { consentedModels: state.consentedModels.filter(entry => entry !== key) }
  }),
  isModelConsented: (provider, model) => get().consentedModels.includes(`${provider}:${model}`),
  getApiKey: provider => get().apiKeys[provider] || '',
  setResearchConfig: patch => set(state => ({ research: { ...state.research, ...patch } })),
}), {
  name: 'yuha-settings',
  // apiKeys are encrypted (AES-256-GCM, device key in IndexedDB) by the
  // storage adapter before they ever touch localStorage.
  storage: createJSONStorage(() => secureSettingsStorage satisfies StateStorage),
  skipHydration: true,
  version: 7,
  partialize: state => ({
    collaborationMode: state.collaborationMode,
    apiKeys: state.apiKeys,
    activeProvider: state.activeProvider,
    activeModel: state.activeModel,
    roleModels: state.roleModels,
    allowPaidModels: state.allowPaidModels,
    executionAutoRunConsented: state.executionAutoRunConsented,
    consentedModels: state.consentedModels,
    research: state.research,
  }),
  onRehydrateStorage: () => () => {
    // Remove the obsolete co-located encryption key from the former browser-storage scheme.
    try { if (typeof window !== 'undefined') window.localStorage.removeItem('yuha-device-key') } catch { /* Storage may be unavailable. */ }
  },
  migrate: (persisted: unknown) => {
    const state = persisted as Partial<SettingsState> & { paidBudgetLimit?: number }
    const validProviders: ProviderType[] = ['gemini', 'groq', 'openrouter', 'ollama', 'kimi', 'qwen']
    const active = validProviders.includes(state.activeProvider as ProviderType) ? (state.activeProvider as ProviderType) : 'gemini'
    return {
      collaborationMode: state.collaborationMode === 'economy' || state.collaborationMode === 'max' ? state.collaborationMode : 'balanced',
      // v6 and earlier never persisted credentials; v7+ restores them from
      // the encrypted blob the storage adapter already decrypted for us.
      apiKeys: sanitizeApiKeys(state.apiKeys),
      activeProvider: active,
      activeModel: state.activeModel || '',
      roleModels: state.roleModels || {},
      allowPaidModels: state.allowPaidModels === true,
      executionAutoRunConsented: state.executionAutoRunConsented === true,
      research: sanitizeResearchConfig((persisted as { research?: unknown }).research),
      consentedModels: Array.isArray((persisted as { consentedModels?: unknown }).consentedModels)
        ? ((persisted as { consentedModels: unknown[] }).consentedModels.filter(entry => typeof entry === 'string') as string[]).slice(0, 500)
        : [],
    }
  },
}))

const RESEARCH_IDS: ResearchProviderId[] = ['tavily', 'serpapi', 'searxng', 'duckduckgo', 'brave', 'exa', 'firecrawl']

function sanitizeResearchConfig(raw: unknown): ResearchConfig {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const keys: Partial<Record<ResearchProviderId, string>> = {}
  const rawKeys = value.keys && typeof value.keys === 'object' ? value.keys as Record<string, unknown> : {}
  for (const id of RESEARCH_IDS) {
    const key = rawKeys[id]
    if (typeof key === 'string' && key.length <= 4096) keys[id] = key
  }
  const enabled: Partial<Record<ResearchProviderId, boolean>> = {}
  const rawEnabled = value.enabled && typeof value.enabled === 'object' ? value.enabled as Record<string, unknown> : {}
  for (const id of RESEARCH_IDS) {
    if (typeof rawEnabled[id] === 'boolean') enabled[id] = rawEnabled[id] === true
  }
  const order = Array.isArray(value.order)
    ? (value.order.filter((entry): entry is ResearchProviderId => typeof entry === 'string' && RESEARCH_IDS.includes(entry as ResearchProviderId)) as ResearchProviderId[])
    : []
  const maxResults = typeof value.maxResults === 'number' && Number.isInteger(value.maxResults) ? Math.min(Math.max(value.maxResults, 1), 10) : 5
  const searxngBaseUrl = typeof value.searxngBaseUrl === 'string' ? value.searxngBaseUrl.slice(0, 300) : ''
  return {
    keys,
    enabled,
    order: order.length ? [...new Set(order)] : ['tavily', 'brave', 'serpapi', 'exa', 'searxng', 'duckduckgo'],
    maxResults,
    searxngBaseUrl,
    autoResearch: value.autoResearch === true,
  }
}
