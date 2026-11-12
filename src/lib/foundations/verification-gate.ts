/**
 * YUHA ARCHITECTURE FOUNDATION 7: Acceptance-Driven Verification Gate
 * Enforces rigorous 7-level verification before a project or work order is marked passed.
 * Prevents premature "Passed" claims without tangible verification evidence.
 */

import type { VerificationReport, VerificationStatus, YuhaManifest } from '@/types'
import { ManifestContractManager } from './manifest-contract'

export class VerificationGateEngine {
  /**
   * Executes multi-level verification on workspace files against a manifest and acceptance criteria
   */
  public static verifyWorkspace(
    files: Record<string, string>,
    manifest?: YuhaManifest,
    criteria: string[] = []
  ): VerificationReport {
    const id = 'vr-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6)

    // This function is a static workspace inspection only. It does not execute
    // a compiler, test runner, build, browser preview, or acceptance scenario.
    // Therefore those levels must never be reported as Passed here.
    let contractStatus: VerificationStatus = 'Not Run'
    let contractMessage = 'No manifest provided'
    if (manifest) {
      const contractRes = ManifestContractManager.validateContract(manifest, files)
      contractStatus = contractRes.valid ? 'Passed' : 'Failed'
      contractMessage = contractRes.valid
        ? 'Manifest contract passed static validation'
        : `Contract violations: ${contractRes.missingFiles.join(', ') || contractRes.errors.join('; ')}`
    }

    const paths = Object.keys(files)
    const emptyFiles = paths.filter(filePath => !files[filePath] || files[filePath].trim().length === 0)
    const filesystemStatus: VerificationStatus = paths.length === 0 || emptyFiles.length > 0 ? 'Failed' : 'Passed'
    const filesystemMessage = paths.length === 0
      ? 'Workspace filesystem is empty'
      : emptyFiles.length > 0
        ? `Found empty files: ${emptyFiles.join(', ')}`
        : `Static check passed: ${paths.length} non-empty workspace files`

    const typeStatus: VerificationStatus = 'Not Run'
    const buildStatus: VerificationStatus = 'Not Run'
    const testStatus: VerificationStatus = 'Not Run'
    const runtimeStatus: VerificationStatus = 'Not Run'
    const acceptanceStatus: VerificationStatus = criteria.length > 0 ? 'Blocked' : 'Not Run'

    const hardFailure = filesystemStatus === 'Failed' || contractStatus === 'Failed'
    const overallStatus: VerificationStatus = hardFailure ? 'Failed' : 'Partially Verified'

    return {
      id,
      timestamp: Date.now(),
      overallStatus,
      levels: {
        contract: { status: contractStatus, message: contractMessage },
        filesystem: { status: filesystemStatus, message: filesystemMessage },
        typeCheck: { status: typeStatus, message: 'Not executed: static inspection cannot replace TypeScript/compiler checks' },
        build: { status: buildStatus, message: 'Not executed: run the project build command to verify this level' },
        tests: { status: testStatus, message: 'Not executed: discovering test files is not evidence that tests passed' },
        runtime: { status: runtimeStatus, message: 'Not executed: a browser/runtime smoke test is required' },
        acceptance: { status: acceptanceStatus, message: criteria.length > 0 ? 'Acceptance criteria require executed build, tests, and runtime evidence' : 'No acceptance criteria supplied' },
      },
    }
  }
}
