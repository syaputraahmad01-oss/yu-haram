import type { FileMap } from '@/types'

export interface AuditFinding {
  id: string
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  category: string
  title: string
  description: string
  detail?: string
  recommendation?: string
  file?: string
  line?: number
}

export function auditProject(files: FileMap): AuditFinding[] {
  const findings: AuditFinding[] = []
  let idCounter = 1

  for (const [path, content] of Object.entries(files)) {
    if (/AIza[0-9A-Za-z-_]{35}/.test(content) || /sk-[a-zA-Z0-9]{48}/.test(content)) {
      findings.push({
        id: `finding-${idCounter++}`,
        severity: 'critical',
        category: 'Secret Leak',
        title: 'Hardcoded API Key',
        description: `Potential hardcoded API key detected in ${path}.`,
        detail: `File: ${path} contains matching pattern for third-party cloud credential.`,
        recommendation: 'Remove keys from source files and use environment variables or prompt headers.',
        file: path,
      })
    }
    if (path.includes('.env') && !path.includes('.example')) {
      findings.push({
        id: `finding-${idCounter++}`,
        severity: 'high',
        category: 'Sensitive File',
        title: 'Environment File in Workspace',
        description: `${path} may contain sensitive secrets that should not be committed to Git.`,
        detail: `Found private environment file: ${path}`,
        recommendation: 'Add .env to .gitignore and commit only .env.example templates.',
        file: path,
      })
    }
  }
  return findings
}
