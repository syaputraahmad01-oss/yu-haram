'use client'
import { useState } from 'react'
import { ChevronDown, Download, GitBranch, LoaderCircle, Play, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Brand } from './Brand'
import { useFileStore } from '@/lib/store/useFileStore'
import { useWebContainer } from '@/hooks/useWebContainer'
import { toast } from 'sonner'
import { ProjectHistoryDialog } from './ProjectHistoryDialog'
export function Header({
  onNewProject,
  onOpenFoundations,
  onOpenShip,
  onOpenSettings,
}: {
  onNewProject: () => void
  onOpenFoundations?: () => void
  onOpenShip?: () => void
  onOpenSettings?: () => void
}) {
  const { projectName, setProjectName, files } = useFileStore()
  const { boot, stop, isBooting, serverUrl } = useWebContainer()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(projectName)
  const [exporting, setExporting] = useState(false)
  const exportProject = async () => {
    setExporting(true)
    try {
      const { default: JSZip } = await import('jszip'); const zip = new JSZip()
      Object.entries(files).forEach(([path, content]) => zip.file(path, content))
      const url = URL.createObjectURL(await zip.generateAsync({ type: 'blob' })); const link = document.createElement('a'); link.href = url; link.download = projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.zip'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
      useFileStore.getState().markSaved(); toast.success('Project exported successfully.')
    } catch { toast.error('Could not export the project. Please try again.') } finally { setExporting(false) }
  }
  const saveName = () => { setProjectName(name); setEditing(false) }
  return <header className="app-header">
    <Brand version /><div className="header-divider" />
    {editing ? <input className="project-name-input" aria-label="Project name" value={name} autoFocus onChange={event => setName(event.target.value)} onBlur={saveName} onKeyDown={event => { if (event.nativeEvent.isComposing || event.keyCode === 229) return; if (event.key === 'Enter') saveName(); if (event.key === 'Escape') setEditing(false) }} /> : <button className="project-menu" onClick={() => { setName(projectName); setEditing(true) }} title="Rename project"><span className="project-name">{projectName}</span><ChevronDown /></button>}
    <span className="branch-pill"><GitBranch /> main</span>

    {onOpenFoundations && (
      <button
        onClick={onOpenFoundations}
        className="hidden md:flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-emerald-400 bg-emerald-950/40 border border-emerald-500/30 rounded-full hover:bg-emerald-900/40 transition-colors"
        title="View 15 Architecture Foundations"
      >
        <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
        15 Foundations Active
      </button>
    )}

    <div className="header-actions">
      <ProjectHistoryDialog />
      {onOpenShip && (
        <Button variant="outline" size="sm" onClick={onOpenShip} aria-label="Open Ship Center">
          Ship
        </Button>
      )}
      {onOpenSettings && (
        <Button variant="ghost" size="sm" onClick={onOpenSettings} aria-label="Open Settings">
          Settings
        </Button>
      )}
      <Button variant="outline" size="sm" className="export-button" onClick={exportProject} disabled={exporting} aria-label="Export project ZIP">{exporting ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : <Download data-icon="inline-start" />}<span className="export-label">Export</span></Button>
      <Button size="sm" className="run-button" onClick={() => { void (serverUrl ? stop() : boot()) }} disabled={isBooting}>{isBooting ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : serverUrl ? <Square data-icon="inline-start" /> : <Play data-icon="inline-start" />}{isBooting ? 'Starting' : serverUrl ? 'Stop app' : 'Run app'}</Button>
      <button className="avatar-button" aria-label="Create a new project" title="Create a new project" onClick={onNewProject}>Y</button>
    </div>
  </header>
}
