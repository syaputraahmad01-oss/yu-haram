'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { useFileStore } from '@/lib/store/useFileStore'
import { useAppStore } from '@/lib/store/useAppStore'
import { useTerminalStore } from '@/lib/store/useTerminalStore'
import { staticPreview } from '@/lib/webcontainer/templates'
import { injectPreviewDiagnosticsBridge, parsePreviewDiagnosticMessage } from '@/lib/runtime/diagnostics'
import { cn } from '@/lib/utils'

export function previewSandbox(serverUrl?: string | null): string {
  // allow-same-origin is granted ONLY to WebContainer dev servers
  // (*.webcontainer.io), whose in-browser runtime needs it. Any other
  // serverUrl — and any unparseable one — gets the stricter sandbox
  // WITHOUT same-origin access.
  const withSameOrigin = 'allow-scripts allow-same-origin allow-forms allow-popups'
  const withoutSameOrigin = 'allow-scripts allow-forms allow-popups'
  if (!serverUrl) return withoutSameOrigin
  try {
    return new URL(serverUrl).hostname.endsWith('.webcontainer.io')
      ? withSameOrigin
      : withoutSameOrigin
  } catch {
    return withoutSameOrigin
  }
}

export function PreviewIframe({ revision }: { revision: number }) {
  const files = useFileStore(state => state.files)
  const serverUrl = useAppStore(state => state.serverUrl)
  const runtimeStatus = useAppStore(state => state.runtimeStatus)
  const device = useAppStore(state => state.device)
  const isRunning = useTerminalStore(state => state.isRunning)
  const staticDocument = useMemo(() => injectPreviewDiagnosticsBridge(staticPreview(files)), [files])
  const frameKey = `${serverUrl ?? 'static'}-${revision}`
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    setLoadedKey(null)
  }, [frameKey])

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return

      if (serverUrl) {
        let expectedOrigin: string
        try {
          expectedOrigin = new URL(serverUrl).origin
        } catch {
          return
        }
        if (event.origin !== expectedOrigin) return
      } else {
        // On sandboxed srcDoc without allow-same-origin, browsers assign a unique origin whose serialized string is 'null'
        if (event.origin !== 'null' && event.origin !== '') return
      }

      // Validate message shape and bounds (max 64KB)
      if (!event.data || typeof event.data !== 'object') return
      try {
        const rawString = JSON.stringify(event.data)
        if (rawString.length > 65_536) return
      } catch {
        return
      }

      const diagnostic = parsePreviewDiagnosticMessage(event.data)
      if (!diagnostic) return
      const message = diagnostic.kind === 'unhandledrejection'
        ? `Preview unhandled promise rejection: ${diagnostic.message}`
        : `Preview JavaScript error: ${diagnostic.message}`
      useTerminalStore.getState().addDiagnostic(message, 'preview', diagnostic.details)
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [serverUrl, frameKey])

  const loading = serverUrl
    ? loadedKey !== frameKey
    : isRunning || ['booting', 'installing', 'starting'].includes(runtimeStatus)

  return (
    <div className="preview-viewport">
      <div className={cn('preview-frame', device)}>
        {loading && (
          <div className="preview-loading" role="status" aria-live="polite">
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            <span>{runtimeStatus === 'installing' ? 'Installing dependencies…' : 'Loading preview…'}</span>
          </div>
        )}
        <iframe
          ref={iframeRef}
          key={frameKey}
          title="Application preview"
          className="preview-iframe"
          src={serverUrl ?? undefined}
          srcDoc={serverUrl ? undefined : staticDocument}
          onLoad={() => setLoadedKey(frameKey)}
          sandbox={previewSandbox(serverUrl)}
          allow="cross-origin-isolated"
        />
      </div>
    </div>
  )
}
