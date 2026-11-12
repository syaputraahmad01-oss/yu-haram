'use client'
import { useEffect } from 'react'
import { useAppStore } from '@/lib/store/useAppStore'
import { useFileStore } from '@/lib/store/useFileStore'
import { toast } from 'sonner'
export function useKeyboardShortcuts() {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229 || !(event.ctrlKey || event.metaKey)) return
      const app = useAppStore.getState(); const files = useFileStore.getState()
      if (event.key.toLowerCase() === 's') { event.preventDefault(); files.markSaved(files.activeFile || undefined); toast.success('Project saved in this browser') }
      if (event.key.toLowerCase() === 'b') { event.preventDefault(); app.toggleFileTree() }
      if (event.key === '`') { event.preventDefault(); app.toggleTerminal() }
      if (event.key.toLowerCase() === 'k') { event.preventDefault(); app.setMobilePanel('chat'); document.getElementById('chat-input')?.focus() }
      if (event.key.toLowerCase() === 'w') { event.preventDefault(); if (files.activeFile) files.closeFile(files.activeFile) }
      if (event.key.toLowerCase() === 'n' && event.shiftKey) { event.preventDefault(); app.setView('code'); setTimeout(() => document.querySelector<HTMLButtonElement>('[aria-label="New file"]')?.click(), 0) }
    }
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler)
  }, [])
}
