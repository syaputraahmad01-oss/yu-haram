'use client'

import { FileCode2, X } from 'lucide-react'
import { useFileStore } from '@/lib/store/useFileStore'
import { getFileName } from '@/lib/utils/file-helpers'
import { cn } from '@/lib/utils'

export function EditorTabs() {
  const activeFile = useFileStore(state => state.activeFile)
  const openFiles = useFileStore(state => state.openFiles)
  const modifiedFiles = useFileStore(state => state.modifiedFiles)
  const openFile = useFileStore(state => state.openFile)
  const closeFile = useFileStore(state => state.closeFile)

  return (
    <div className="editor-tabs" role="tablist" aria-label="Open files">
      {openFiles.map(path => {
        const active = activeFile === path
        const modified = modifiedFiles.includes(path)
        return (
          <div className={cn('editor-tab', active && 'active')} key={path}>
            <button
              type="button"
              role="tab"
              id={`editor-tab-${encodeURIComponent(path)}`}
              aria-selected={active}
              aria-controls="active-file-editor"
              tabIndex={active ? 0 : -1}
              className="editor-tab-select"
              onClick={() => openFile(path)}
              title={path}
            >
              <FileCode2 aria-hidden="true" />
              <span>{getFileName(path)}</span>
              {modified && <span className="editor-tab-modified" aria-label="Unsaved changes" />}
            </button>
            <button
              type="button"
              className="editor-tab-close"
              aria-label={`Close ${path}`}
              title={`Close ${path}`}
              onClick={() => closeFile(path)}
            >
              <X aria-hidden="true" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
