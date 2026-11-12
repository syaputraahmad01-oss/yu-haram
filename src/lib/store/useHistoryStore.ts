import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useFileStore } from '@/lib/store/useFileStore'
import type { FileMap, ProjectSnapshot } from '@/types'

export interface SnapshotOptions {
  label: string
  files?: FileMap
  activeFile?: string
  projectName?: string
}

interface HistoryState {
  snapshots: ProjectSnapshot[]
  createSnapshot: (
    labelOrOptions: string | SnapshotOptions,
    files?: FileMap,
    activeFile?: string,
    projectName?: string
  ) => void
  deleteSnapshot: (id: string) => void
  removeSnapshot: (id: string) => void
  clearSnapshots: () => void
  restoreSnapshot: (id: string) => { success: boolean; label?: string; error?: string }
}

export const useHistoryStore = create<HistoryState>()(
  persist(
    (set, get) => ({
      snapshots: [],
      createSnapshot: (labelOrOptions, customFiles, activeFile, projectName) => {
        const fileStore = useFileStore.getState()
        let resolvedLabel: string
        let resolvedFiles: FileMap
        let resolvedActive: string | undefined
        let resolvedProject: string

        if (typeof labelOrOptions === 'object') {
          resolvedLabel = labelOrOptions.label
          resolvedFiles = labelOrOptions.files ?? fileStore.files
          resolvedActive = labelOrOptions.activeFile ?? fileStore.activeFile ?? undefined
          resolvedProject = labelOrOptions.projectName ?? fileStore.projectName
        } else {
          resolvedLabel = labelOrOptions
          resolvedFiles = customFiles ?? fileStore.files
          resolvedActive = activeFile ?? fileStore.activeFile ?? undefined
          resolvedProject = projectName ?? fileStore.projectName
        }

        const totalSize = JSON.stringify(resolvedFiles).length
        if (totalSize > 500_000) return

        set(state => {
          const now = Date.now()
          const snapshot: ProjectSnapshot = {
            id: 'snap-' + now + '-' + Math.random().toString(36).slice(2, 7),
            timestamp: now,
            createdAt: now,
            label: resolvedLabel,
            files: { ...resolvedFiles },
            activeFile: resolvedActive,
            projectName: resolvedProject,
            totalBytes: totalSize,
          }
          return {
            snapshots: [snapshot, ...state.snapshots.slice(0, 4)],
          }
        })
      },
      deleteSnapshot: id =>
        set(state => ({
          snapshots: state.snapshots.filter(s => s.id !== id),
        })),
      removeSnapshot: id =>
        set(state => ({
          snapshots: state.snapshots.filter(s => s.id !== id),
        })),
      clearSnapshots: () => set({ snapshots: [] }),
      restoreSnapshot: (id: string) => {
        const snapshot = get().snapshots.find(s => s.id === id)
        if (!snapshot) return { success: false, error: 'Snapshot not found' }
        try {
          const files = { ...snapshot.files }
          useFileStore.getState().setFiles(files)
          if (snapshot.projectName) {
            useFileStore.getState().setProjectName(snapshot.projectName)
          }
          if (snapshot.activeFile && files[snapshot.activeFile] !== undefined) {
            useFileStore.getState().openFile(snapshot.activeFile)
          }
          return { success: true, label: snapshot.label }
        } catch (err) {
          return { success: false, error: err instanceof Error ? err.message : 'Failed to restore snapshot' }
        }
      },
    }),
    {
      name: 'yuha-history-storage',
      skipHydration: true,
    }
  )
)
