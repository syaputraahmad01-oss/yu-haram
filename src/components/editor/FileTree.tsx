'use client'
import { useMemo, useState } from 'react'
import { ChevronDown, FilePlus2, FolderPlus, PencilLine, Trash2 } from 'lucide-react'
import { useFiles } from '@/hooks/useFiles'
import { buildFileTree } from '@/lib/utils/file-helpers'
import { FileTreeItem } from './FileTreeItem'
import { IconButton } from '@/components/layout/IconButton'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
export function FileTree() {
  const { files, createFile, renameFile, deleteFile, projectName } = useFiles(); const tree = useMemo(() => buildFileTree(files), [files])
  const [dialog, setDialog] = useState<'file' | 'folder' | 'manage' | null>(null); const [path, setPath] = useState(''); const [original, setOriginal] = useState('')
  const create = () => { try { if (dialog === 'manage') renameFile(original, path); else createFile(dialog === 'folder' ? path.replace(/\/$/, '') + '/.gitkeep' : path); setDialog(null); toast.success(dialog === 'manage' ? 'Renamed successfully' : dialog === 'folder' ? 'Folder created' : 'File created') } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not update the project.') } }
  return <aside className="file-tree" aria-label="Project files"><div className="file-tree-heading"><span>EXPLORER</span><div><IconButton label="New file" onClick={() => { setPath(''); setDialog('file') }}><FilePlus2 /></IconButton><IconButton label="New folder" onClick={() => { setPath(''); setDialog('folder') }}><FolderPlus /></IconButton></div></div><div className="file-tree-root"><ChevronDown /><span className="truncate">{projectName.toUpperCase()}</span></div><div className="tree-items">{tree.map(node => <FileTreeItem key={node.path} node={node} onManage={path => { setOriginal(path); setPath(path); setDialog('manage') }} />)}</div>
    <Dialog open={!!dialog} onOpenChange={(open: boolean) => { if (!open) setDialog(null) }}><DialogContent><DialogHeader><DialogTitle>{dialog === 'manage' ? 'Manage file or folder' : dialog === 'folder' ? 'Create a folder' : 'Create a file'}</DialogTitle><DialogDescription>{dialog === 'manage' ? 'Rename this item, or permanently remove it from your project.' : 'Use a relative project path, such as src/components/Header.tsx.'}</DialogDescription></DialogHeader><form onSubmit={event => { event.preventDefault(); create() }}><Field><FieldLabel htmlFor="new-path">{dialog === 'folder' ? 'Folder path' : 'File path'}</FieldLabel><Input autoFocus id="new-path" value={path} onChange={event => setPath(event.target.value)} placeholder={dialog === 'folder' ? 'src/components' : 'src/components/Header.tsx'} /></Field><DialogFooter className="mt-5">{dialog === 'manage' && <Button type="button" variant="destructive" onClick={() => { deleteFile(original); setDialog(null); toast.success('Item removed from project') }}><Trash2 data-icon="inline-start" />Delete</Button>}<Button type="submit" disabled={!path.trim()}>{dialog === 'manage' ? <><PencilLine data-icon="inline-start" />Rename</> : 'Create'}</Button></DialogFooter></form></DialogContent></Dialog>
  </aside>
}
