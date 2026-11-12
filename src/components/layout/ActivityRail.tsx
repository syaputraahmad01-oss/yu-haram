'use client'
import { Code2, FolderClosed, MessageSquare, Moon, Plus, Settings2, Sun, TerminalSquare, Rocket, ShieldCheck } from 'lucide-react'
import { useAppStore } from '@/lib/store/useAppStore'
import { IconButton } from './IconButton'
import { cn } from '@/lib/utils'
export function ActivityRail({ onHelp, onNewProject }: { onHelp: () => void; onNewProject: () => void }) {
  const { view, setView, toggleTerminal, toggleFileTree, theme, toggleTheme } = useAppStore()
  return <nav className="activity-rail" aria-label="Workspace navigation">
    <IconButton className="rail-button active" label="Assistant" onClick={() => document.getElementById('chat-input')?.focus()}><MessageSquare /></IconButton>
    <IconButton className={cn('rail-button', view === 'code' && 'active')} label="Project files" onClick={() => { if (view === 'code') toggleFileTree(); else setView('code') }}><FolderClosed /></IconButton>
    <IconButton className={cn('rail-button', view === 'split' && 'active')} label="Split editor and preview" onClick={() => setView(view === 'split' ? 'preview' : 'split')}><Code2 /></IconButton>
    <IconButton className="rail-button" label="Toggle terminal · ⌘ `" onClick={toggleTerminal}><TerminalSquare /></IconButton>
    <IconButton
      className="rail-button"
      label="15 Architecture Foundations"
      onClick={() => window.dispatchEvent(new CustomEvent('yuha:open-foundations'))}
    >
      <ShieldCheck className="text-emerald-400" />
    </IconButton>
    <IconButton
      className="rail-button"
      label="Ship Center"
      onClick={() => window.dispatchEvent(new CustomEvent('yuha:open-ship'))}
    >
      <Rocket />
    </IconButton>
    <div className="rail-spacer" />
    <IconButton className="rail-button" label="New project" onClick={onNewProject}><Plus /></IconButton>
    <IconButton className="rail-button" label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} onClick={toggleTheme}>{theme === 'dark' ? <Sun /> : <Moon />}</IconButton>
    <IconButton
      className="rail-button"
      label="Provider settings"
      onClick={() => window.dispatchEvent(new CustomEvent('yuha:open-settings'))}
    >
      <Settings2 />
    </IconButton>
    <IconButton className="rail-button" label="Keyboard shortcuts" onClick={onHelp}><span className="rail-help">?</span></IconButton>
  </nav>
}
