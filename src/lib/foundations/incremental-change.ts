/**
 * YUHA ARCHITECTURE FOUNDATION 8: Incremental Change Protocol
 * Governs targeted modifications to existing workspaces without rewriting entire projects.
 * Analyzes impact, creates structured patches, and enables atomic rollbacks on regression.
 */

export interface ChangeImpactAnalysis {
  requestedChange: string
  targetFiles: string[]
  unaffectedFiles: string[]
  isAtomic: boolean
  riskLevel: 'low' | 'medium' | 'high'
}

export interface PatchOperation {
  filePath: string
  action: 'create' | 'update' | 'delete'
  originalContent?: string
  newContent?: string
  diffSummary?: string
}

export class IncrementalChangeProtocol {
  /**
   * Analyzes a user instruction to identify only the files that need changes
   */
  public static analyzeChangeImpact(
    instruction: string,
    existingFiles: Record<string, string>
  ): ChangeImpactAnalysis {
    const allPaths = Object.keys(existingFiles)
    const targetFiles: string[] = []

    const lower = instruction.toLowerCase()
    for (const path of allPaths) {
      const fileName = path.split('/').pop()?.toLowerCase() || ''
      if (lower.includes(fileName) || lower.includes(path.toLowerCase())) {
        targetFiles.push(path)
      }
    }

    // Heuristics for common modifications
    if (targetFiles.length === 0) {
      if (/style|color|theme|css|background/i.test(lower)) {
        const cssFiles = allPaths.filter(p => p.endsWith('.css'))
        targetFiles.push(...cssFiles)
      }
      if (/button|component|ui|modal|navbar|header/i.test(lower)) {
        const compFiles = allPaths.filter(p => p.includes('components/') || p.endsWith('App.tsx'))
        targetFiles.push(...compFiles.slice(0, 3))
      }
      if (/route|api|endpoint/i.test(lower)) {
        const apiFiles = allPaths.filter(p => p.includes('api/'))
        targetFiles.push(...apiFiles)
      }
    }

    // Default to main component if still none identified
    if (targetFiles.length === 0 && allPaths.includes('src/App.tsx')) {
      targetFiles.push('src/App.tsx')
    }

    const unaffectedFiles = allPaths.filter(p => !targetFiles.includes(p))
    const riskLevel: 'low' | 'medium' | 'high' =
      targetFiles.length > 5 || targetFiles.some(p => p.includes('package.json')) ? 'high' : targetFiles.length > 2 ? 'medium' : 'low'

    return {
      requestedChange: instruction,
      targetFiles,
      unaffectedFiles,
      isAtomic: true,
      riskLevel,
    }
  }

  /**
   * Applies an atomic set of file changes with rollback backup
   */
  public static applyAtomicPatch(
    currentFiles: Record<string, string>,
    patches: PatchOperation[]
  ): { updatedFiles: Record<string, string>; backupFiles: Record<string, string> } {
    const backupFiles = { ...currentFiles }
    const updatedFiles = { ...currentFiles }

    for (const patch of patches) {
      if (patch.action === 'create' || patch.action === 'update') {
        if (patch.newContent !== undefined) {
          updatedFiles[patch.filePath] = patch.newContent
        }
      } else if (patch.action === 'delete') {
        delete updatedFiles[patch.filePath]
      }
    }

    return { updatedFiles, backupFiles }
  }
}
