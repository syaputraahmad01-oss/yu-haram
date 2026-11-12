'use client'
import { useState } from 'react'
import { Clock3, RotateCcw, Trash2, History, Camera } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useFileStore } from '@/lib/store/useFileStore'
import { useHistoryStore } from '@/lib/store/useHistoryStore'
import { useAppStore } from '@/lib/store/useAppStore'
import { currentContainer, mountFiles } from '@/lib/webcontainer'

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(timestamp))
}

export function ProjectHistoryDialog() {
  const [open, setOpen] = useState(false)
  const [restoring, setRestoring] = useState<string | null>(null)
  const snapshots = useHistoryStore(state => state.snapshots)
  const createSnapshot = useHistoryStore(state => state.createSnapshot)
  const removeSnapshot = useHistoryStore(state => state.removeSnapshot)

  const saveCurrent = () => {
    const state = useFileStore.getState()
    try {
      createSnapshot({ label: 'Snapshot manual', projectName: state.projectName, files: state.files, activeFile: state.activeFile ?? undefined })
      toast.success('Snapshot proyek berhasil disimpan di browser ini.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Snapshot gagal disimpan.')
    }
  }

  const restore = async (id: string) => {
    const snapshot = useHistoryStore.getState().snapshots.find(item => item.id === id)
    if (!snapshot) return
    setRestoring(id)
    try {
      const files = { ...snapshot.files }
      useFileStore.getState().setFiles(files)
      if (snapshot.projectName) useFileStore.getState().setProjectName(snapshot.projectName)
      if (snapshot.activeFile && files[snapshot.activeFile] !== undefined) useFileStore.getState().openFile(snapshot.activeFile)
      if (currentContainer()) await mountFiles(files)
      useAppStore.getState().setRuntime({ runtimeError: null })
      toast.success(`Versi ${snapshot.label} berhasil dipulihkan.`)
      setOpen(false)
    } catch (error) {
      toast.error(error instanceof Error ? `Pemulihan gagal: ${error.message}` : 'Pemulihan snapshot gagal.')
    } finally {
      setRestoring(null)
    }
  }

  return <>
    <Button variant="outline" size="sm" onClick={() => setOpen(true)} aria-label="Buka riwayat proyek">
      <History data-icon="inline-start" /> <span className="hidden sm:inline">Riwayat</span>
    </Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Riwayat proyek</DialogTitle>
          <DialogDescription>Snapshot disimpan di penyimpanan browser ini. Snapshot tidak otomatis tersinkron ke perangkat lain.</DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-muted-foreground">{snapshots.length} dari 5 snapshot tersimpan</span>
          <Button size="sm" onClick={saveCurrent}><Camera data-icon="inline-start" />Simpan versi sekarang</Button>
        </div>
        <div className="max-h-[min(52vh,440px)] space-y-2 overflow-y-auto">
          {snapshots.length === 0 ? <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Belum ada snapshot. Simpan versi sekarang atau biarkan YUHA membuat snapshot sebelum perubahan AI.</div> : snapshots.map(snapshot => (
            <div key={snapshot.id} className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="font-medium">{snapshot.label}</div>
                <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground"><span className="inline-flex items-center gap-1"><Clock3 className="size-3" />{formatDate(snapshot.createdAt || snapshot.timestamp)}</span><span>{Object.keys(snapshot.files).length} file</span><span>{Math.ceil((snapshot.totalBytes || 0) / 1024)} KB</span></div>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button size="sm" variant="outline" disabled={restoring !== null} onClick={() => void restore(snapshot.id)}>{restoring === snapshot.id ? <RotateCcw className="animate-spin" data-icon="inline-start" /> : <RotateCcw data-icon="inline-start" />}Pulihkan</Button>
                <Button size="icon" variant="ghost" aria-label={`Hapus ${snapshot.label}`} disabled={restoring !== null} onClick={() => removeSnapshot(snapshot.id)}><Trash2 /></Button>
              </div>
            </div>
          ))}
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Tutup</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>
}
