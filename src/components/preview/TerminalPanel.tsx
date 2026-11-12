'use client'
import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, LoaderCircle, TerminalSquare, Trash2, X } from 'lucide-react'
import { useTerminalStore } from '@/lib/store/useTerminalStore'
import { useAppStore } from '@/lib/store/useAppStore'
import { currentContainer } from '@/lib/webcontainer'
import { IconButton } from '@/components/layout/IconButton'
import { toast } from 'sonner'
import type { Terminal } from '@xterm/xterm'
import type { WebContainerProcess } from '@webcontainer/api'
export function TerminalPanel() {
  const containerRef = useRef<HTMLDivElement>(null); const terminalRef = useRef<Terminal | null>(null); const writerRef = useRef<WritableStreamDefaultWriter<string> | null>(null)
  const [command, setCommand] = useState(''); const { webcontainerReady, toggleTerminal } = useAppStore(); const isRunning = useTerminalStore(state => state.isRunning)
  useEffect(() => {
    let disposed = false; let observer: ResizeObserver | null = null; let unsubscribe: (() => void) | null = null; let shell: WebContainerProcess | null = null
    const setup = async () => {
      const [{ Terminal }, { FitAddon }, { WebLinksAddon }] = await Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit'), import('@xterm/addon-web-links')])
      if (disposed || !containerRef.current) return
      const terminal = new Terminal({ fontSize: 11, lineHeight: 1.5, fontFamily: 'JetBrains Mono, monospace', cursorBlink: true, convertEol: true, scrollback: 5000, theme: { background: '#151619', foreground: '#abb3c4', cursor: '#89a7ff', selectionBackground: '#344463' } })
      const fit = new FitAddon(); terminal.loadAddon(fit); terminal.loadAddon(new WebLinksAddon()); terminal.open(containerRef.current); fit.fit(); terminalRef.current = terminal
      useTerminalStore.getState().lines.forEach(line => terminal.write(line))
      unsubscribe = useTerminalStore.subscribe((state, previous) => { if (state.lines === previous.lines) return; if (!state.lines.length) terminal.clear(); else terminal.write(state.lines.at(-1) || '') })
      observer = new ResizeObserver(() => { try { fit.fit(); shell?.resize({ cols: terminal.cols, rows: terminal.rows }) } catch { /* The terminal can be hidden during a panel switch. */ } }); observer.observe(containerRef.current)
      const container = currentContainer()
      if (container && webcontainerReady) {
        shell = await container.spawn('jsh', { terminal: { cols: terminal.cols, rows: terminal.rows } })
        if (disposed) { shell.kill(); return }
        const writer = shell.input.getWriter(); writerRef.current = writer
        terminal.onData(data => { void writer.write(data).catch(() => {}) })
        void shell.output.pipeTo(new WritableStream({ write: data => useTerminalStore.getState().appendLine(data) })).catch(() => {})
      }
    }
    void setup().catch(() => toast.error('Terminal could not initialize. Try closing and reopening it.'))
    return () => { disposed = true; observer?.disconnect(); unsubscribe?.(); shell?.kill(); writerRef.current?.releaseLock(); writerRef.current = null; terminalRef.current?.dispose(); terminalRef.current = null }
  }, [webcontainerReady])
  return <section className="terminal-panel" aria-label="Terminal"><div className="terminal-heading"><span><TerminalSquare />Terminal</span><span>{isRunning && <LoaderCircle className="size-2.5 animate-spin" />}{webcontainerReady ? 'jsh' : 'Browser runtime not started'}</span><div className="heading-actions"><IconButton label="Clear terminal" onClick={() => useTerminalStore.getState().clearLines()}><Trash2 /></IconButton><IconButton label="Close terminal" onClick={toggleTerminal}><X /></IconButton></div></div><div className="terminal-screen" ref={containerRef} /><form className="terminal-command" onSubmit={event => { event.preventDefault(); if (!writerRef.current) { toast.info('Click Run app to start the browser runtime first.'); return } void writerRef.current.write(command + '\r').catch(() => toast.error('The shell is unavailable. Reopen the terminal.')); setCommand('') }}><span>›</span><input aria-label="Terminal command" value={command} onChange={event => setCommand(event.target.value)} placeholder="Run a command..." autoComplete="off" spellCheck={false} /><button aria-label="Execute command" type="submit"><ArrowUpRight /></button></form></section>
}
