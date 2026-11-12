import type { DiagnosticItem } from '@/types'

export function injectPreviewDiagnosticsBridge(html: string): string {
  if (!html.includes('<head>') && !html.includes('<html>')) return html
  const bridgeScript = `<script>
(function() {
  function sendDiag(type, msg, stack) {
    try {
      window.parent.postMessage({
        type: 'YUHA_PREVIEW_DIAGNOSTIC',
        payload: {
          id: 'diag-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
          timestamp: Date.now(),
          type: 'preview',
          message: String(msg || 'Unknown preview error'),
          stack: stack ? String(stack).slice(0, 4000) : undefined
        }
      }, '*');
    } catch (e) {}
  }
  window.addEventListener('error', function(e) { sendDiag('runtime', e.message || 'Error in preview', e.error ? e.error.stack : null); });
  window.addEventListener('unhandledrejection', function(e) { sendDiag('runtime', e.reason ? (e.reason.message || String(e.reason)) : 'Unhandled rejection', e.reason ? e.reason.stack : null); });
})();
</script>`
  if (html.includes('</head>')) return html.replace('</head>', `${bridgeScript}</head>`)
  return `${bridgeScript}${html}`
}

export function parsePreviewDiagnosticMessage(data: unknown): DiagnosticItem | null {
  if (typeof data !== 'object' || data === null) return null
  const msg = data as { type?: string; payload?: unknown }
  if (msg.type !== 'YUHA_PREVIEW_DIAGNOSTIC' || typeof msg.payload !== 'object' || !msg.payload) return null
  const payload = msg.payload as Record<string, unknown>
  if (typeof payload.message !== 'string') return null
  return {
    id: typeof payload.id === 'string' ? payload.id : 'diag-' + Date.now(),
    timestamp: typeof payload.timestamp === 'number' ? payload.timestamp : Date.now(),
    type: 'preview',
    message: payload.message.slice(0, 1000),
    stack: typeof payload.stack === 'string' ? payload.stack.slice(0, 4000) : undefined,
  }
}

export function formatDiagnosticsForAgent(diagnostics: DiagnosticItem[]): string {
  return [
    'Berikut adalah diagnostik terminal/runtime yang tertangkap dari eksekusi WebContainer:',
    ...diagnostics.map((d, index) => `${index + 1}. [${d.type.toUpperCase()}] ${d.message}${d.stack ? `\nStack:\n${d.stack}` : ''}`),
    'Tolong analisis dan perbaiki kode yang relevan agar build/runtime lulus tanpa error.',
  ].join('\n')
}
