/**
 * YUHA ARCHITECTURE FOUNDATION 3: Deterministic Repair Gate
 * Fixes deterministic, mechanical issues using verifiable algorithms without spending AI tokens.
 * Handles missing imports, typo fixes, missing boilerplate configs, trailing braces, and path fixes.
 */

export interface DeterministicFixResult {
  applied: boolean
  fixType: string
  details: string
  updatedContent?: string
  modifiedFiles?: Record<string, string>
}

export class DeterministicRepairGate {
  /**
   * Fixes common unclosed braces or brackets in code files
   */
  public static fixUnbalancedBraces(code: string): DeterministicFixResult {
    let openBraces = 0
    let openParens = 0
    let inString = false
    let stringChar = ''

    for (let i = 0; i < code.length; i++) {
      const char = code[i]
      const prev = i > 0 ? code[i - 1] : ''

      if (inString) {
        if (char === stringChar && prev !== '\\') {
          inString = false
        }
        continue
      }

      if (char === '"' || char === "'" || char === '`') {
        inString = true
        stringChar = char
        continue
      }

      if (char === '{') openBraces++
      else if (char === '}') openBraces--
      else if (char === '(') openParens++
      else if (char === ')') openParens--
    }

    if (openBraces === 0 && openParens === 0) {
      return { applied: false, fixType: 'braces', details: 'Braces and parentheses are balanced' }
    }

    let repaired = code
    while (openParens > 0) {
      repaired += ')'
      openParens--
    }
    while (openBraces > 0) {
      repaired += '\n}'
      openBraces--
    }

    return {
      applied: true,
      fixType: 'unbalanced_braces',
      details: 'Deterministically appended missing closing brackets/parentheses',
      updatedContent: repaired,
    }
  }

  /**
   * Detects missing standard configuration files in a workspace and supplies safe templates
   */
  public static ensureEssentialConfigFiles(files: Record<string, string>): DeterministicFixResult {
    const missing: string[] = []
    const modified: Record<string, string> = {}

    // 1. Ensure .gitignore
    if (!files['.gitignore']) {
      missing.push('.gitignore')
      modified['.gitignore'] = 'node_modules\ndist\n.env\n.env.local\n'
    }

    // 2. Ensure .env.example if missing
    if (!files['.env.example'] && !files['.env']) {
      missing.push('.env.example')
      modified['.env.example'] = '# Example Environment Variables\nVITE_APP_NAME="YUHA Application"\n'
    }

    if (missing.length === 0) {
      return { applied: false, fixType: 'config_files', details: 'All essential config files exist' }
    }

    return {
      applied: true,
      fixType: 'essential_configs',
      details: `Generated essential missing files: ${missing.join(', ')}`,
      modifiedFiles: modified,
    }
  }

  /**
   * Cleans up common Markdown fence wrappers mistakenly injected by models into file content
   */
  public static stripAccidentalFences(content: string): DeterministicFixResult {
    const trimmed = content.trim()
    const fenceRegex = /^```(?:[a-zA-Z0-9_-]+)?\r?\n([\s\S]*?)\r?\n```$/

    const match = trimmed.match(fenceRegex)
    if (match && match[1]) {
      return {
        applied: true,
        fixType: 'accidental_fence_strip',
        details: 'Stripped accidental outer Markdown code fence wrapper',
        updatedContent: match[1],
      }
    }

    return { applied: false, fixType: 'accidental_fence_strip', details: 'No outer markdown fence found' }
  }

  /**
   * Repairs missing React import in JSX files when required by old bundlers
   */
  public static ensureReactImport(filePath: string, content: string): DeterministicFixResult {
    if (!/\.(?:jsx|tsx)$/.test(filePath)) {
      return { applied: false, fixType: 'react_import', details: 'Not a JSX/TSX file' }
    }

    const hasJsx = /<[A-Z][A-Za-z0-9]*|<\/[A-Za-z0-9]+>|<[a-z]+ [^>]*\/>/.test(content)
    const hasReactImport = /import\s+.*React.*from\s+['"]react['"]/.test(content)

    if (hasJsx && !hasReactImport && !content.includes('import * as React from')) {
      return {
        applied: true,
        fixType: 'react_import_injection',
        details: 'Deterministically added standard React import to JSX/TSX file',
        updatedContent: "import React from 'react';\n" + content,
      }
    }

    return { applied: false, fixType: 'react_import', details: 'React import already present or not needed' }
  }
}
