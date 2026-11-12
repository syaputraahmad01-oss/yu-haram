/**
 * YUHA ARCHITECTURE FOUNDATION 4: Manifest-Driven File Contract
 * Governs the structured project manifest (yuha.manifest.json).
 * Guarantees that planned files, modules, dependencies, and entrypoints match the actual workspace.
 * Prevents the AI model from assuming a file exists before it is created.
 */

import type { YuhaManifest } from '@/types'

export interface ManifestValidationResult {
  valid: boolean
  missingFiles: string[]
  untrackedFiles: string[]
  invalidRoles: string[]
  errors: string[]
}

export class ManifestContractManager {
  public static createDefaultManifest(name = 'yuha-project'): YuhaManifest {
    return {
      manifestVersion: '1.0.0',
      projectId: 'proj-' + Math.random().toString(36).slice(2, 9),
      name,
      type: 'spa',
      version: '0.1.0',
      framework: 'react',
      language: 'typescript',
      entryPoint: 'src/main.tsx',
      dependencies: {
        react: '^19.0.0',
        'react-dom': '^19.0.0',
      },
      files: {
        'package.json': { role: 'config', description: 'Project dependencies and scripts' },
        'index.html': { role: 'entry', description: 'HTML entry point' },
        'src/main.tsx': { role: 'entry', description: 'Application bootstrap' },
        'src/App.tsx': { role: 'component', description: 'Root application component' },
        'src/index.css': { role: 'style', description: 'Global styling and design tokens' },
      },
    }
  }

  /**
   * Reconciles the manifest contract against actual files present in the workspace
   */
  public static validateContract(
    manifest: YuhaManifest,
    workspaceFiles: Record<string, string>
  ): ManifestValidationResult {
    const missingFiles: string[] = []
    const errors: string[] = []
    const invalidRoles: string[] = []

    // 1. Check that all planned files in the manifest exist in workspace
    for (const [path, meta] of Object.entries(manifest.files)) {
      if (workspaceFiles[path] === undefined) {
        missingFiles.push(path)
      }
      if (!['entry', 'component', 'style', 'config', 'util', 'test', 'route', 'asset'].includes(meta.role)) {
        invalidRoles.push(`${path}: unknown role ${meta.role}`)
      }
    }

    // 2. Check entrypoint
    if (workspaceFiles[manifest.entryPoint] === undefined) {
      errors.push(`Manifest designated entryPoint "${manifest.entryPoint}" is missing from workspace.`)
    }

    // 3. Find files in workspace not tracked in manifest
    const untrackedFiles = Object.keys(workspaceFiles).filter(
      path => manifest.files[path] === undefined && !path.startsWith('node_modules/') && !path.startsWith('.git/')
    )

    const valid = missingFiles.length === 0 && errors.length === 0 && invalidRoles.length === 0

    return {
      valid,
      missingFiles,
      untrackedFiles,
      invalidRoles,
      errors,
    }
  }

  /**
   * Syncs workspace files into the manifest
   */
  public static syncWorkspaceToManifest(
    manifest: YuhaManifest,
    workspaceFiles: Record<string, string>
  ): YuhaManifest {
    const updated = { ...manifest, files: { ...manifest.files } }
    for (const path of Object.keys(workspaceFiles)) {
      if (!updated.files[path]) {
        let role: 'entry' | 'component' | 'style' | 'config' | 'util' | 'test' | 'route' | 'asset' = 'util'
        if (path === 'index.html' || path.includes('main.tsx') || path.includes('layout.tsx')) role = 'entry'
        else if (path.endsWith('.css')) role = 'style'
        else if (path.includes('components/') || path.endsWith('App.tsx')) role = 'component'
        else if (path.endsWith('.json') || path.includes('config')) role = 'config'
        else if (path.includes('test') || path.endsWith('.test.ts') || path.endsWith('.spec.ts')) role = 'test'

        updated.files[path] = { role }
      }
    }
    return updated
  }
}
