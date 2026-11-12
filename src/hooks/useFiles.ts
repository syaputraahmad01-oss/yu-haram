'use client'
import { useFileStore } from '@/lib/store/useFileStore'
import { createWorkspaceFile, deleteWorkspacePath, renameWorkspacePath, updateWorkspaceFile } from '@/lib/workspace/actions'
import { toast } from 'sonner'

function reportSyncError(error: unknown) {
  toast.error(error instanceof Error ? error.message : 'Could not synchronize the project file.')
}

export function useFiles() {
  const state = useFileStore()
  return {
    ...state,
    updateFileContent: (path: string, content: string) => {
      updateWorkspaceFile(path, content, { syncRuntime: true })
    },
    createFile: (path: string, content = '') => {
      createWorkspaceFile(path, content, { syncRuntime: true })
    },
    deleteFile: (path: string) => {
      void deleteWorkspacePath(path).catch(reportSyncError)
    },
    renameFile: (oldPath: string, newPath: string) => {
      void renameWorkspacePath(oldPath, newPath).catch(reportSyncError)
    },
  }
}
