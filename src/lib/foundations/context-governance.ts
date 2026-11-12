/**
 * YUHA ARCHITECTURE FOUNDATION 9: Context Pack Governance
 * Curates token-bounded context packs for AI models.
 * Strictly excludes sensitive files (.env, private keys) and redacts secrets BEFORE transmission.
 */

import { buildProjectContext, redactSecrets, isSensitiveFile } from '@/lib/ai/orchestration'

export interface ContextPack {
  id: string
  timestamp: number
  totalCharacters: number
  estimatedTokens: number
  includedFiles: string[]
  omittedFilesCount: number
  redactedSecretsCount: number
  renderedPromptContext: string
}

export class ContextPackGovernance {
  /**
   * Builds an audited, sanitized, token-bounded context pack for model consumption
   */
  public static buildContextPack(
    files: Record<string, string>,
    maxCharLimit = 250_000,
    recentFiles: string[] = []
  ): ContextPack {
    const id = 'ctx-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6)

    // Count redacted secrets across the whole workspace
    let redactedSecretsCount = 0
    for (const [path, content] of Object.entries(files)) {
      if (isSensitiveFile(path)) continue
      const redacted = redactSecrets(content)
      if (redacted !== content) {
        // Redaction occurred
        redactedSecretsCount++
      }
    }

    const { context, omittedCount, includedFiles } = buildProjectContext(files, maxCharLimit, recentFiles)

    // Token estimation heuristic: ~4 chars per token
    const estimatedTokens = Math.ceil(context.length / 4)

    return {
      id,
      timestamp: Date.now(),
      totalCharacters: context.length,
      estimatedTokens,
      includedFiles,
      omittedFilesCount: omittedCount,
      redactedSecretsCount,
      renderedPromptContext: context,
    }
  }
}
