'use client'
import { useState } from 'react'
import { ChevronDown, ChevronRight, FileCode2, FileJson, FileText, Folder, FolderOpen, MoreHorizontal } from 'lucide-react'
import type { FileNode } from '@/types'
import { useFileStore } from '@/lib/store/useFileStore'
import { cn } from '@/lib/utils'
export function FileTreeItem({ node, depth = 0, onManage }: { node: FileNode; depth?: number; onManage: (path: string) => void }) {
  const [expanded, setExpanded] = useState(true)
  const activeFile = useFileStore(state => state.activeFile); const openFile = useFileStore(state => state.openFile)
  const folder = node.type === 'folder'; const extension = node.name.split('.').pop(); const Icon = folder ? expanded ? FolderOpen : Folder : extension === 'json' ? FileJson : ['tsx', 'ts', 'jsx', 'js', 'css'].includes(extension || '') ? FileCode2 : FileText
  return <><div className={cn('tree-row', activeFile === node.path && 'active')} style={{ paddingLeft: depth * 12 + 12 }}><button onClick={() => folder ? setExpanded(!expanded) : openFile(node.path)} aria-expanded={folder ? expanded : undefined} title={node.path}>{folder ? expanded ? <ChevronDown className="file-chevron" /> : <ChevronRight className="file-chevron" /> : <span style={{ width: 9, flexShrink: 0 }} />}<Icon className={cn(!folder && (extension === 'css' ? 'file-color-css' : extension === 'json' ? 'file-color-json' : 'file-color-ts'))} /><span>{node.name}</span></button><button className="tree-more" aria-label={`Manage ${node.path}`} onClick={() => onManage(node.path)}><MoreHorizontal /></button></div>{folder && expanded && node.children?.map(child => <FileTreeItem node={child} depth={depth + 1} onManage={onManage} key={child.path} />)}</>
}
