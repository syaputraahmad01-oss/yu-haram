'use client'

import { FileCode2 } from 'lucide-react'
import { useAppStore } from '@/lib/store/useAppStore'
import { useFileStore } from '@/lib/store/useFileStore'
import { updateWorkspaceFile } from '@/lib/workspace/actions'
import { FileTree } from './FileTree'
import { EditorTabs } from './EditorTabs'
import { MonacoEditorWrapper } from './MonacoEditorWrapper'

export function EditorPanel() {
  const activeFile = useFileStore(state => state.activeFile)
  const showFileTree = useAppStore(state => state.showFileTree)
  const content = useFileStore(state => activeFile ? state.files[activeFile] ?? null : null)

  const handleChange = (nextContent: string) => {
    // Resolve the active path at event time so delayed editor callbacks cannot write to a stale file.
    const currentPath = useFileStore.getState().activeFile
    if (!currentPath || !Object.hasOwn(useFileStore.getState().files, currentPath)) return
    updateWorkspaceFile(currentPath, nextContent, { syncRuntime: true })
  }

  return (
    <section className="editor-panel" aria-label="Code editor">
      {showFileTree && <FileTree />}
      <div className="editor-main">
        <EditorTabs />
        {activeFile && content !== null ? (
          <div className="editor-surface" key={activeFile}>
            <MonacoEditorWrapper path={activeFile} value={content} onChange={handleChange} />
          </div>
        ) : (
          <div className="editor-empty" role="status">
            <FileCode2 aria-hidden="true" />
            <p>Select a file from the explorer to start editing.</p>
          </div>
        )}
      </div>
    </section>
  )
}
