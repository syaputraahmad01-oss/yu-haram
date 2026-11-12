'use client'

import { useState } from 'react'
import { AlertTriangle, LoaderCircle, X } from 'lucide-react'
import { useAppStore } from '@/lib/store/useAppStore'
import { useWebContainer } from '@/hooks/useWebContainer'
import { useFileStore } from '@/lib/store/useFileStore'
import { useTerminalStore } from '@/lib/store/useTerminalStore'
import { formatDiagnosticsForAgent } from '@/lib/runtime/diagnostics'
import { toast } from 'sonner'
import { VITE_REACT_TEMPLATE } from '@/lib/webcontainer/templates'
import { PreviewToolbar } from './PreviewToolbar'
import { PreviewIframe } from './PreviewIframe'

export function PreviewPanel() {
  const [revision, setRevision] = useState(0)
  const serverUrl = useAppStore(state => state.serverUrl)
  const runtimeStatus = useAppStore(state => state.runtimeStatus)
  const runtimeError = useAppStore(state => state.runtimeError)
  const diagnostics = useTerminalStore(state => state.diagnostics)
  const files = useFileStore(state => state.files)
  const { boot, stop } = useWebContainer()
  const needsRuntime = Object.entries(files).some(([path, content]) => /\.[jt]sx?$/.test(path) && content !== VITE_REACT_TEMPLATE[path])
  const busy = ['booting', 'installing', 'starting', 'stopping'].includes(runtimeStatus)

  return (
    <section className="preview-panel" aria-label="Application preview">
      <PreviewToolbar
        refresh={() => setRevision(value => value + 1)}
        onRun={() => { void boot() }}
        onStop={() => { void stop() }}
        isBusy={busy}
        isRunning={!!serverUrl}
      />
      {runtimeError && (
        <div className="runtime-alert" role="alert">
          <AlertTriangle aria-hidden="true" />
          <span>{runtimeError}</span>
          <button type="button" aria-label="Dismiss runtime error" onClick={() => useAppStore.getState().setRuntime({ runtimeError: null, runtimeStatus: 'idle' })}>
            <X aria-hidden="true" />
          </button>
        </div>
      )}
      {diagnostics.length > 0 && (
        <div className="runtime-diagnostics" role="region" aria-label="Runtime diagnostics">
          <div className="runtime-diagnostics-copy">
            <AlertTriangle aria-hidden="true" />
            <span><strong>{diagnostics.length} diagnostic(s)</strong> captured from terminal/runtime. Review before asking the agent to repair.</span>
          </div>
          <div className="runtime-diagnostics-actions">
            <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(formatDiagnosticsForAgent(diagnostics)); toast.success('Diagnostics copied. Paste them into the chat to request a repair.') } catch { toast.error('Could not access clipboard.') } }}>Copy for agent</button>
            <button type="button" onClick={() => useTerminalStore.getState().clearDiagnostics()}>Clear</button>
          </div>
        </div>
      )}
      {busy && (
        <div className="runtime-progress" role="status" aria-live="polite">
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          <span>{runtimeStatus === 'installing' ? 'Installing dependencies…' : runtimeStatus === 'starting' ? 'Starting development server…' : runtimeStatus === 'stopping' ? 'Stopping preview…' : 'Preparing browser runtime…'}</span>
        </div>
      )}
      {!serverUrl && needsRuntime && !busy && !runtimeError && (
        <div className="preview-start-prompt">
          <p>Run your project to open the live preview.</p>
          <button type="button" onClick={() => { void boot() }}>Run project</button>
        </div>
      )}
      <PreviewIframe revision={revision} />
    </section>
  )
}
