'use client'
import { create } from 'zustand'

export type WorkspaceView = 'preview' | 'code' | 'split'
export type RuntimeStatus = 'idle' | 'booting' | 'installing' | 'starting' | 'ready' | 'stopping' | 'error'
type RuntimeState = Pick<AppState, 'isBooting' | 'webcontainerReady' | 'runtimeError' | 'runtimeStatus'>

export interface PendingConfirmation {
  id: string
  title: string
  description?: string
  command?: string
  packages?: string[]
  onConfirm: () => void
  onCancel: () => void
}

interface AppState {
  view: WorkspaceView
  showTerminal: boolean
  showFileTree: boolean
  theme: 'dark' | 'light'
  serverUrl: string | null
  isBooting: boolean
  webcontainerReady: boolean
  runtimeError: string | null
  runtimeStatus: RuntimeStatus
  device: 'desktop' | 'tablet' | 'mobile'
  mobilePanel: 'chat' | 'workbench'
  pendingConfirmation: PendingConfirmation | null
  requestConfirmation: (conf: Omit<PendingConfirmation, 'id' | 'onConfirm' | 'onCancel'>) => Promise<boolean>
  dismissConfirmation: () => void
  setView: (view: WorkspaceView) => void
  toggleTerminal: () => void
  toggleFileTree: () => void
  toggleTheme: () => void
  setServerUrl: (url: string | null) => void
  setRuntime: (state: Partial<RuntimeState>) => void
  setDevice: (device: AppState['device']) => void
  setMobilePanel: (mobilePanel: AppState['mobilePanel']) => void
}

export const useAppStore = create<AppState>(set => ({
  view: 'preview',
  showTerminal: false,
  showFileTree: true,
  theme: 'dark',
  serverUrl: null,
  isBooting: false,
  webcontainerReady: false,
  runtimeError: null,
  runtimeStatus: 'idle',
  device: 'desktop',
  mobilePanel: 'chat',
  pendingConfirmation: null,
  requestConfirmation: conf => {
    return new Promise<boolean>(resolve => {
      set({
        pendingConfirmation: {
          id: crypto.randomUUID(),
          ...conf,
          onConfirm: () => {
            set({ pendingConfirmation: null })
            resolve(true)
          },
          onCancel: () => {
            set({ pendingConfirmation: null })
            resolve(false)
          },
        },
      })
    })
  },
  dismissConfirmation: () => {
    set(state => {
      if (state.pendingConfirmation) {
        state.pendingConfirmation.onCancel()
      }
      return { pendingConfirmation: null }
    })
  },
  setView: view => set({ view }),
  toggleTerminal: () => set(state => ({ showTerminal: !state.showTerminal })),
  toggleFileTree: () => set(state => ({ showFileTree: !state.showFileTree })),
  toggleTheme: () => set(state => ({ theme: state.theme === 'dark' ? 'light' : 'dark' })),
  setServerUrl: serverUrl => set(() => ({
    serverUrl,
    ...(serverUrl ? { runtimeStatus: 'ready' as const, runtimeError: null, isBooting: false } : {}),
  })),
  setRuntime: runtime => set(state => {
    const next = { ...state, ...runtime }
    const runtimeStatus = runtime.runtimeStatus
      ?? (runtime.runtimeError ? 'error' : runtime.isBooting ? 'booting' : next.serverUrl ? 'ready' : state.runtimeStatus)
    return { ...runtime, runtimeStatus }
  }),
  setDevice: device => set({ device }),
  setMobilePanel: mobilePanel => set({ mobilePanel }),
}))
