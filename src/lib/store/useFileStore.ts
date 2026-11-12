import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { VITE_REACT_TEMPLATE } from '@/lib/webcontainer/templates'
import type { FileMap } from '@/types'

interface FileState {
  projectName: string
  files: FileMap
  activeFile: string | null
  openFiles: string[]
  modifiedFiles: string[]
  setProjectName: (name: string) => void
  setFiles: (files: FileMap) => void
  setFile: (path: string, content: string) => void
  updateFileContent: (path: string, content: string) => void
  openFile: (path: string) => void
  closeFile: (path: string) => void
  markSaved: (path?: string) => void
  removeFile: (path: string) => void
  renameFile: (oldPath: string, newPath: string) => void
  setActiveFile: (path: string | null) => void
  reset: () => void
}

export const useFileStore = create<FileState>()(
  persist(
    (set) => ({
      projectName: 'my-project',
      files: { ...VITE_REACT_TEMPLATE },
      activeFile: 'src/App.jsx',
      openFiles: ['src/App.jsx', 'package.json'],
      modifiedFiles: [],
      setProjectName: projectName => set({ projectName }),
      setFiles: files => set({ files }),
      setFile: (path, content) =>
        set(state => ({
          files: { ...state.files, [path]: content },
          modifiedFiles: state.modifiedFiles.includes(path) ? state.modifiedFiles : [...state.modifiedFiles, path],
        })),
      updateFileContent: (path, content) =>
        set(state => ({
          files: { ...state.files, [path]: content },
          modifiedFiles: state.modifiedFiles.includes(path) ? state.modifiedFiles : [...state.modifiedFiles, path],
        })),
      openFile: path =>
        set(state => ({
          activeFile: path,
          openFiles: state.openFiles.includes(path) ? state.openFiles : [...state.openFiles, path],
        })),
      closeFile: path =>
        set(state => {
          const nextOpen = state.openFiles.filter(p => p !== path)
          return {
            openFiles: nextOpen,
            activeFile: state.activeFile === path ? (nextOpen[nextOpen.length - 1] ?? null) : state.activeFile,
          }
        }),
      markSaved: path =>
        set(state => ({
          modifiedFiles: path ? state.modifiedFiles.filter(p => p !== path) : [],
        })),
      removeFile: path =>
        set(state => {
          const next = { ...state.files }
          delete next[path]
          return {
            files: next,
            openFiles: state.openFiles.filter(p => p !== path),
            modifiedFiles: state.modifiedFiles.filter(p => p !== path),
            activeFile: state.activeFile === path ? (Object.keys(next)[0] ?? null) : state.activeFile,
          }
        }),
      renameFile: (oldPath, newPath) =>
        set(state => {
          if (!Object.hasOwn(state.files, oldPath)) return state
          const next = { ...state.files }
          next[newPath] = next[oldPath]
          delete next[oldPath]
          return {
            files: next,
            openFiles: state.openFiles.map(p => (p === oldPath ? newPath : p)),
            modifiedFiles: state.modifiedFiles.map(p => (p === oldPath ? newPath : p)),
            activeFile: state.activeFile === oldPath ? newPath : state.activeFile,
          }
        }),
      setActiveFile: activeFile =>
        set(state => ({
          activeFile,
          openFiles: activeFile && !state.openFiles.includes(activeFile) ? [...state.openFiles, activeFile] : state.openFiles,
        })),
      reset: () =>
        set({
          projectName: 'my-project',
          files: { ...VITE_REACT_TEMPLATE },
          activeFile: 'src/App.jsx',
          openFiles: ['src/App.jsx', 'package.json'],
          modifiedFiles: [],
        }),
    }),
    {
      name: 'yuha-files-storage',
      skipHydration: true,
    }
  )
)
