import type { FileMap, FileTreeNode } from '@/types'

/**
 * Normalize and sanitize a workspace relative file path.
 * Strictly prevents path traversal (..), null bytes, Windows drive letters, and absolute root escapes.
 */
export function safePath(rawPath: string): string {
  if (typeof rawPath !== 'string' || !rawPath.trim()) return ''
  const cleaned = rawPath.trim()
  // Reject instead of silently rewriting attacker-controlled paths.
  if (cleaned.includes('\0') || cleaned.startsWith('/') || cleaned.startsWith('\\') || /^[a-zA-Z]:/.test(cleaned)) return ''
  const normalized = cleaned.replace(/\\/g, '/')
  const parts = normalized.split('/')
  if (parts.some(part => !part || part === '.' || part === '..' || /^\.+$/.test(part))) return ''
  if (parts.some(part => /[\u0000-\u001f]/.test(part))) return ''
  return parts.join('/')
}

export function isPathSafe(rawPath: string): boolean {
  if (typeof rawPath !== 'string' || !rawPath.trim()) return false
  if (rawPath.includes('\0')) return false
  if (rawPath.startsWith('/') || rawPath.startsWith('\\') || /^[a-zA-Z]:/.test(rawPath)) return false
  const parts = rawPath.replace(/\\/g, '/').split('/')
  return !parts.some(p => !p || p.trim() === '.' || p.trim() === '..' || /^\.+$/.test(p.trim()) || /[\u0000-\u001f]/.test(p))
}

export function getFileName(path: string): string {
  return path.split('/').pop() || path
}

export function getFileLanguage(path: string): string {
  if (path.endsWith('.tsx') || path.endsWith('.ts')) return 'typescript'
  if (path.endsWith('.jsx') || path.endsWith('.js') || path.endsWith('.mjs')) return 'javascript'
  if (path.endsWith('.css')) return 'css'
  if (path.endsWith('.html')) return 'html'
  if (path.endsWith('.json')) return 'json'
  if (path.endsWith('.md')) return 'markdown'
  return 'plaintext'
}

export function buildFileTree(files: FileMap): FileTreeNode[] {
  const root: FileTreeNode[] = []

  const sortedPaths = Object.keys(files).sort()
  for (const path of sortedPaths) {
    const parts = path.split('/')
    let currentLevel = root
    let currentPath = ''

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      currentPath = currentPath ? `${currentPath}/${part}` : part
      const isFolder = i < parts.length - 1

      let existing = currentLevel.find(node => node.name === part)
      if (!existing) {
        existing = {
          name: part,
          path: currentPath,
          isFolder,
          type: isFolder ? 'folder' : 'file',
          ...(isFolder ? { children: [] } : {}),
        }
        currentLevel.push(existing)
      }
      if (isFolder && existing.children) {
        currentLevel = existing.children
      }
    }
  }

  const sortNodes = (nodes: FileTreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.isFolder === b.isFolder) return a.name.localeCompare(b.name)
      return a.isFolder ? -1 : 1
    })
    for (const node of nodes) {
      if (node.children) sortNodes(node.children)
    }
  }

  sortNodes(root)
  return root
}
