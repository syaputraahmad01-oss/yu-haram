import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface ModelTestResult {
  status: 'success' | 'failed' | 'testing'
  credential?: string
  checkedAt?: number
  latency?: number
  error?: string
}

interface ConnectionState {
  results: Record<string, ModelTestResult>
  setResult: (key: string, result: ModelTestResult) => void
  record: (provider: string, model: string, result: ModelTestResult) => void
  clearResults: () => void
}

export const useConnectionStore = create<ConnectionState>()(
  persist(
    (set) => ({
      results: {},
      setResult: (key, result) =>
        set(state => ({
          results: { ...state.results, [key]: result },
        })),
      record: (provider, model, result) => {
        const key = `${provider}:${model}`
        set(state => ({
          results: {
            ...state.results,
            [key]: {
              ...result,
              checkedAt: result.checkedAt ?? Date.now(),
            },
          },
        }))
      },
      clearResults: () => set({ results: {} }),
    }),
    {
      name: 'yuha-connections-storage',
      skipHydration: true,
      // Never persist the raw credential: it would leak the API key in
      // plaintext. It stays in memory only, where it is used to detect whether
      // a stored result belongs to the currently saved key.
      partialize: state => ({
        results: Object.fromEntries(
          Object.entries(state.results).map(([key, result]) => [key, { ...result, credential: undefined }])
        ),
      }),
    }
  )
)
