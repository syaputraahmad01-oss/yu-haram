import { create } from 'zustand'
import type { DiagnosticItem } from '@/types'

interface TerminalState {
  isRunning: boolean
  status: 'idle' | 'booting' | 'installing' | 'starting' | 'ready' | 'stopping' | 'error'
  diagnostics: DiagnosticItem[]
  lines: string[]
  setRunning: (isRunning: boolean) => void
  setStatus: (status: TerminalState['status']) => void
  appendLine: (chunk: string) => void
  addDiagnostic: (message: string, type?: DiagnosticItem['type'], stack?: string) => void
  clearDiagnostics: () => void
  clearTerminal: () => void
  clearLines: () => void
}

export const useTerminalStore = create<TerminalState>((set) => ({
  isRunning: false,
  status: 'idle',
  diagnostics: [],
  lines: [],
  setRunning: isRunning => set({ isRunning }),
  setStatus: status => set({ status }),
  appendLine: chunk =>
    set(state => ({
      lines: [...state.lines.slice(-500), chunk],
    })),
  addDiagnostic: (message, type = 'runtime', stack) =>
    set(state => ({
      diagnostics: [
        ...state.diagnostics.slice(-39),
        {
          id: 'diag-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
          timestamp: Date.now(),
          type,
          message,
          stack,
        },
      ],
    })),
  clearDiagnostics: () => set({ diagnostics: [] }),
  clearTerminal: () => set({ lines: [] }),
  clearLines: () => set({ lines: [] }),
}))
