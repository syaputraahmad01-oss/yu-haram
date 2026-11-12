'use client'
import { useEffect, useState } from 'react'
import { Braces, Code2, Eye, GitBranch, PanelLeftClose, PanelTop, Plus, Radio, Settings2, ShieldCheck, TerminalSquare } from 'lucide-react'
import Link from 'next/link'
import { Header } from './Header'
import { ActivityRail } from './ActivityRail'
import { ChatPanel } from '@/components/chat/ChatPanel'
import { EditorPanel } from '@/components/editor/EditorPanel'
import { PreviewPanel } from '@/components/preview/PreviewPanel'
import { TerminalPanel } from '@/components/preview/TerminalPanel'
import { ErrorBoundary } from './ErrorBoundary'
import { IconButton } from './IconButton'
import { useAppStore } from '@/lib/store/useAppStore'
import { useFileStore } from '@/lib/store/useFileStore'
import { useChatStore } from '@/lib/store/useChatStore'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { stopProject } from '@/lib/webcontainer'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { Panel, PanelGroup } from 'react-resizable-panels'
import { PanelResizer } from './PanelResizer'
import { SettingsModal } from '@/components/settings/SettingsModal'
import { FoundationsModal } from '@/components/foundations/FoundationsModal'
import { ShipModal } from '@/components/ship/ShipModal'
export default function WorkspaceLayout() {
  const { view, setView, showTerminal, toggleTerminal, theme, mobilePanel, setMobilePanel, toggleFileTree, webcontainerReady } = useAppStore()
  const files = useFileStore(state => state.files); const isStreaming = useChatStore(state => state.isStreaming); const [helpOpen, setHelpOpen] = useState(false); const [newOpen, setNewOpen] = useState(false); const [settingsOpen, setSettingsOpen] = useState(false); const [foundationsOpen, setFoundationsOpen] = useState(false); const [shipOpen, setShipOpen] = useState(false)
  useKeyboardShortcuts()
  useEffect(() => { document.documentElement.classList.remove('light', 'dark'); document.documentElement.classList.add(theme) }, [theme])
  useEffect(() => {
    const openSettings = () => setSettingsOpen(true)
    const openFoundations = () => setFoundationsOpen(true)
    const openShip = () => setShipOpen(true)
    window.addEventListener('yuha:open-settings', openSettings)
    window.addEventListener('yuha:open-foundations', openFoundations)
    window.addEventListener('yuha:open-ship', openShip)
    return () => {
      window.removeEventListener('yuha:open-settings', openSettings)
      window.removeEventListener('yuha:open-foundations', openFoundations)
      window.removeEventListener('yuha:open-ship', openShip)
    }
  }, [])
  return <ErrorBoundary><main className="workspace-shell"><Header onNewProject={() => setNewOpen(true)} onOpenFoundations={() => window.dispatchEvent(new CustomEvent('yuha:open-foundations'))} onOpenShip={() => window.dispatchEvent(new CustomEvent('yuha:open-ship'))} onOpenSettings={() => window.dispatchEvent(new CustomEvent('yuha:open-settings'))} /><div className="mobile-tabs"><button className={cn(mobilePanel === 'chat' && 'active')} onClick={() => setMobilePanel('chat')}>Assistant</button><button className={cn(mobilePanel === 'workbench' && 'active')} onClick={() => setMobilePanel('workbench')}>Workspace</button><Link href="/settings" aria-label="Provider settings"><Settings2 className="ml-2 size-3.5 text-muted-foreground" /></Link></div><div className="workspace-body"><ActivityRail onHelp={() => setHelpOpen(true)} onNewProject={() => setNewOpen(true)} /><ChatPanel />
    <section className={cn('workbench', mobilePanel !== 'workbench' && 'mobile-hidden')} aria-label="Workspace"><div className="workbench-header"><div className="view-tabs" role="tablist" aria-label="Workspace view">{([{ id: 'preview', Icon: Eye, text: 'Preview' }, { id: 'code', Icon: Code2, text: 'Code' }, { id: 'split', Icon: PanelTop, text: 'Split' }] as const).map(({ id, Icon, text }) => <button role="tab" aria-selected={view === id} className={cn('view-tab', view === id && 'active')} onClick={() => setView(id)} key={id}><Icon />{text}</button>)}</div><div className="workbench-tools"><span className="framework-badge"><span className="react-symbol" aria-hidden="true">⚛</span>React + TypeScript</span>{view !== 'preview' && <IconButton label="Toggle file explorer" onClick={toggleFileTree}><PanelLeftClose /></IconButton>}<IconButton label="Toggle terminal" onClick={toggleTerminal}><TerminalSquare /></IconButton><IconButton label="Keyboard shortcuts" onClick={() => setHelpOpen(true)}><Braces /></IconButton></div></div><div className="workbench-content"><div className="workbench-panels">{view === 'code' ? <EditorPanel /> : view === 'split' ? <PanelGroup direction="horizontal"><Panel defaultSize={52} minSize={30}><div className="split-editor"><EditorPanel /></div></Panel><PanelResizer /><Panel defaultSize={48} minSize={25}><div className="split-preview"><PreviewPanel /></div></Panel></PanelGroup> : <PreviewPanel />}</div>{showTerminal && <TerminalPanel />}</div>
    </section></div><footer className="workspace-status"><div><span><i className="status-dot" />Workspace ready</span><span className="status-hide-mobile"><ShieldCheck />Runs in your browser</span></div><div><span><GitBranch />main*</span><span>{Object.keys(files).length} files</span><span className="status-hide-mobile"><Radio />{webcontainerReady ? 'Runtime connected' : 'Local workspace'}</span><span className="status-hide-mobile">⌘ K to start a conversation</span></div></footer>
    <Dialog open={helpOpen} onOpenChange={setHelpOpen}><DialogContent><DialogHeader><DialogTitle>A few useful shortcuts</DialogTitle><DialogDescription>Less clicking. More creating.</DialogDescription></DialogHeader><div className="shortcut-grid">{[['Save active file', '⌘ / Ctrl + S'], ['Toggle file explorer', '⌘ / Ctrl + B'], ['Toggle terminal', '⌘ / Ctrl + `'], ['Focus your prompt', '⌘ / Ctrl + K'], ['Create a new file', '⌘ / Ctrl + Shift + N'], ['Close active file', '⌘ / Ctrl + W'], ['Send a message', 'Enter'], ['Add a new line', 'Shift + Enter']].map(([label, keys]) => <div className="shortcut-row" key={label}><span>{label}</span><kbd>{keys}</kbd></div>)}</div></DialogContent></Dialog>
    <Dialog open={newOpen} onOpenChange={setNewOpen}><DialogContent><DialogHeader><DialogTitle>A fresh start?</DialogTitle><DialogDescription>This replaces your current project and clears the conversation. Export a ZIP first if you want to keep your work. Provider settings will stay.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setNewOpen(false)}>Keep building</Button><Button disabled={isStreaming} onClick={() => { void stopProject(); useFileStore.getState().reset(); useChatStore.getState().clearMessages(); useAppStore.getState().setRuntime({ runtimeError: null }); setView('preview'); setNewOpen(false) }}><Plus data-icon="inline-start" />New project</Button></DialogFooter></DialogContent></Dialog>
    <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    <FoundationsModal isOpen={foundationsOpen} onClose={() => setFoundationsOpen(false)} />
    <ShipModal isOpen={shipOpen} onClose={() => setShipOpen(false)} />
    <Dialog open={!!useAppStore.getState().pendingConfirmation} onOpenChange={(open: boolean) => { if (!open) useAppStore.getState().pendingConfirmation?.onCancel() }}><DialogContent><DialogHeader><DialogTitle>{useAppStore(state => state.pendingConfirmation?.title ?? 'Konfirmasi Tindakan')}</DialogTitle><DialogDescription>{useAppStore(state => state.pendingConfirmation?.description ?? 'Periksa perintah sebelum dijalankan.')}</DialogDescription></DialogHeader>{useAppStore(state => state.pendingConfirmation?.command) && <div className="rounded-md bg-black/40 p-3 font-mono text-xs text-emerald-400 border border-white/10 break-all select-all"><code>{useAppStore.getState().pendingConfirmation?.command}</code></div>}{useAppStore(state => (state.pendingConfirmation?.packages?.length ?? 0) > 0) && <div className="space-y-1"><span className="text-xs font-semibold text-muted-foreground">Paket yang akan dipasang:</span><div className="rounded-md bg-black/40 p-3 font-mono text-xs border border-white/10 max-h-36 overflow-y-auto space-y-1">{useAppStore.getState().pendingConfirmation?.packages?.map(pkg => <div key={pkg} className="text-emerald-400">• {pkg}</div>)}</div></div>}<DialogFooter><Button variant="outline" onClick={() => useAppStore.getState().pendingConfirmation?.onCancel()}>Tolak</Button><Button onClick={() => useAppStore.getState().pendingConfirmation?.onConfirm()}>Setujui & Jalankan</Button></DialogFooter></DialogContent></Dialog>
  </main></ErrorBoundary>
}
