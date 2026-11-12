'use client'

import { ArrowLeft, ArrowUpRight, LockKeyhole, Monitor, RotateCw, Smartphone, Tablet, Play, Square, LoaderCircle } from 'lucide-react'
import { IconButton } from '@/components/layout/IconButton'
import { useAppStore } from '@/lib/store/useAppStore'
import { cn } from '@/lib/utils'

interface PreviewToolbarProps {
  refresh: () => void
  onRun?: () => void
  onStop?: () => void
  isBusy?: boolean
  isRunning?: boolean
}

export function PreviewToolbar({ refresh, onRun, onStop, isBusy = false, isRunning = false }: PreviewToolbarProps) {
  const device = useAppStore(state => state.device)
  const setDevice = useAppStore(state => state.setDevice)
  const serverUrl = useAppStore(state => state.serverUrl)

  return (
    <div className="preview-toolbar">
      <div className="preview-navigation">
        <IconButton label="Scroll preview to top" onClick={refresh}><ArrowLeft /></IconButton>
        <IconButton label="Refresh preview" onClick={refresh}><RotateCw /></IconButton>
        {serverUrl ? (
          <a className="preview-address" href={serverUrl} target="_blank" rel="noopener noreferrer" title={serverUrl}>
            <LockKeyhole aria-hidden="true" /><span>{new URL(serverUrl).host}</span>
          </a>
        ) : <span className="preview-address"><LockKeyhole aria-hidden="true" /><span>Local preview</span></span>}
        {serverUrl && <IconButton label="Open preview in a new tab" onClick={() => window.open(serverUrl, '_blank', 'noopener,noreferrer')}><ArrowUpRight /></IconButton>}
      </div>
      <div className="preview-actions">
        {onRun && <button type="button" className="preview-run-button" onClick={onRun} disabled={isBusy} aria-label={isRunning ? 'Restart project preview' : 'Run project'}>
          {isBusy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Play aria-hidden="true" />}
          <span>{isBusy ? 'Working…' : isRunning ? 'Restart' : 'Run'}</span>
        </button>}
        {onStop && isRunning && <button type="button" className="preview-stop-button" onClick={onStop} disabled={isBusy} aria-label="Stop project preview"><Square aria-hidden="true" /><span>Stop</span></button>}
        <IconButton label="Desktop preview" className={cn(device === 'desktop' && 'active')} onClick={() => setDevice('desktop')}><Monitor /></IconButton>
        <IconButton label="Tablet preview" className={cn(device === 'tablet' && 'active')} onClick={() => setDevice('tablet')}><Tablet /></IconButton>
        <IconButton label="Mobile preview" className={cn(device === 'mobile' && 'active')} onClick={() => setDevice('mobile')}><Smartphone /></IconButton>
      </div>
    </div>
  )
}
