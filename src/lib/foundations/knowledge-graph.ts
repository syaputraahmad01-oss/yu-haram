/**
 * YUHA ARCHITECTURE FOUNDATION 11: Project Knowledge Graph & Evidence Ledger
 * Builds an immutable ledger of verifiable evidence (actions, changes, test proofs, decisions)
 * and maintains a dependency knowledge graph of components, modules, and routes.
 *
 * Master Prompt 6.2: import resolution must be performed RELATIVE TO THE
 * IMPORTER'S DIRECTORY, with alias (`@/`), extension and index-file
 * strategies — a valid import must never be reported missing, and evidence
 * must never be marked unverified because the resolver was wrong.
 */

import type { EvidenceRecord } from '@/types'

export interface KnowledgeGraphNode {
  id: string
  label: string
  type: 'file' | 'component' | 'route' | 'model' | 'work_order' | 'test'
  dependencies: string[]
  metadata?: Record<string, unknown>
}

const MODULE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css', '.scss', '.svg', '.vue'] as const

/** Split `a/b/c.ts` into ['a','b','c.ts'] and resolve `.`/`..` segments
 *  against the importer's directory, exactly like Node's algorithm. */
function resolveRelative(importerDir: string, specifier: string): string[] {
  const segments = [...importerDir.split('/').filter(Boolean), ...specifier.split('/')]
  const out: string[] = []
  for (const segment of segments) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') out.pop()
    else out.push(segment)
  }
  return out
}

/**
 * Resolve one import specifier the way a bundler would, against the set of
 * existing workspace files. Returns the resolved path or null.
 *
 * Strategies (in order):
 *  1. `@/alias` → `src/` prefix (TypeScript paths convention).
 *  2. Relative `./x` / `../x` → resolved FROM THE IMPORTER'S DIRECTORY.
 *  3. Package imports (no leading `.`/`@alias`) → external, always "resolved".
 *  4. Exact file, extension variants, then `index` files per directory.
 */
export function resolveImportPath(
  importerPath: string,
  specifier: string,
  files: Record<string, string>,
): string | null {
  if (!specifier) return null
  // External package (react, lodash, node:fs, ~ tailwind alias...) — not our
  // filesystem's business.
  if (!specifier.startsWith('.') && !specifier.startsWith('@/')) return importerPath ? '__external__' : null

  const importerDir = importerPath.includes('/') ? importerPath.slice(0, importerPath.lastIndexOf('/')) : ''
  let baseSegments: string[]
  if (specifier.startsWith('@/')) {
    baseSegments = ['src', ...specifier.slice(2).split('/')]
  } else {
    baseSegments = resolveRelative(importerDir, specifier)
  }
  const base = baseSegments.join('/')

  if (base in files) return base
  if (base === '') return null
  for (const ext of MODULE_EXTENSIONS) {
    if (`${base}${ext}` in files) return `${base}${ext}`
  }
  for (const ext of MODULE_EXTENSIONS) {
    const indexFile = `${base}/index${ext}`
    if (indexFile in files) return indexFile
  }
  return null
}

/** All local (non-package) imports in a file that resolve to a workspace file. */
export function resolvedLocalImports(files: Record<string, string>): { unresolved: string[]; resolved: number } {
  const unresolved: string[] = []
  let resolved = 0
  for (const [path, content] of Object.entries(files)) {
    const specifiers = [...content.matchAll(/import\s+[^'"]*?from\s+['"]([^'"]+)['"]/g)].map(match => match[1])
    for (const specifier of specifiers) {
      const target = resolveImportPath(path, specifier, files)
      if (target === '__external__') continue
      if (target == null) unresolved.push(`${path} -> ${specifier}`)
      else resolved += 1
    }
  }
  return { unresolved, resolved }
}

export class ProjectKnowledgeLedger {
  private evidenceLedger: EvidenceRecord[] = []
  private nodes: Map<string, KnowledgeGraphNode> = new Map()

  public recordEvidence(params: {
    action: string
    actor: string
    inputs: Record<string, unknown>
    outputs: Record<string, unknown>
    verified: boolean
    proof: string
    workOrderId?: string
  }): EvidenceRecord {
    const record: EvidenceRecord = {
      id: 'ev-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      timestamp: Date.now(),
      action: params.action,
      actor: params.actor,
      inputs: params.inputs,
      outputs: params.outputs,
      verified: params.verified,
      proof: params.proof,
      workOrderId: params.workOrderId,
    }
    this.evidenceLedger.push(record)
    return record
  }

  public getLedger(): EvidenceRecord[] {
    return [...this.evidenceLedger]
  }

  public registerNode(node: KnowledgeGraphNode): void {
    this.nodes.set(node.id, { ...node })
  }

  public getNode(id: string): KnowledgeGraphNode | undefined {
    return this.nodes.get(id)
  }

  public getAllNodes(): KnowledgeGraphNode[] {
    return Array.from(this.nodes.values())
  }

  /**
   * Rebuilds file dependency graph from workspace files.
   * Dependencies are stored RESOLVED (workspace path or the external
   * specifier itself) so consumers never re-guess resolution.
   */
  public buildGraphFromFiles(files: Record<string, string>): void {
    this.nodes.clear()
    for (const [path, content] of Object.entries(files)) {
      const importMatches = [...content.matchAll(/import\s+.*?from\s+['"]([^'"]+)['"]/g)].map(m => m[1])
      const dependencies = importMatches.map(specifier => {
        const resolved = resolveImportPath(path, specifier, files)
        return resolved === '__external__' ? specifier : (resolved ?? specifier)
      })
      this.registerNode({
        id: path,
        label: path.split('/').pop() || path,
        type: path.includes('test') ? 'test' : path.includes('components/') ? 'component' : 'file',
        dependencies,
      })
    }
  }
}
