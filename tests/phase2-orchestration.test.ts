/**
 * PHASE 2 regression tests (Master Prompt upgrade, 2026-11-12).
 * Covers: checkpoint schema v2 + TTL + checksum + workspace scoping, the real
 * import resolver (importer-relative, alias, extensions, index, circular), and
 * the blueprint approval gate.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  deriveCheckpointKey, checkpointChecksum, CHECKPOINT_SCHEMA_VERSION, CHECKPOINT_TTL_MS,
  loadCheckpointDetailed, saveCheckpoint, type TaskCheckpoint,
} from '../src/lib/foundations/task-checkpoint'
import { resolveImportPath, resolvedLocalImports, ProjectKnowledgeLedger } from '../src/lib/foundations/knowledge-graph'
import { BlueprintAmbiguityGate } from '../src/lib/foundations/blueprint-gate'
import { VerificationGateEngine } from '../src/lib/foundations/verification-gate'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/* ---------- 5. Checkpoint ---------- */

test('checkpoint keys are workspace-scoped, schema-versioned and TTL-bound', () => {
  const a = deriveCheckpointKey('Buat website marketplace', 'gemini', 'm', 'ws-A')
  const b = deriveCheckpointKey('Buat website marketplace', 'gemini', 'm', 'ws-B')
  assert.notEqual(a, b, 'different workspaces must never share a checkpoint')
  assert.equal(deriveCheckpointKey('Buat  website   MARKETPLACE', 'gemini', 'm', 'ws-A'), a, 'instruction normalization is stable')
  assert.equal(CHECKPOINT_SCHEMA_VERSION, 2)
  assert.ok(CHECKPOINT_TTL_MS === 7 * 24 * 60 * 60 * 1000)
})

function seedCheckpoint(overrides: Partial<TaskCheckpoint> = {}): TaskCheckpoint {
  const base: Omit<TaskCheckpoint, 'checksum'> = {
    checkpointKey: 'test:ws:seed',
    schemaVersion: CHECKPOINT_SCHEMA_VERSION,
    workspaceId: 'ws-test',
    taskId: 'orchestration',
    projectId: 'workspace',
    sessionId: 's1',
    originalInstruction: 'Buat dashboard inventori',
    status: 'interrupted',
    tasks: [{ taskId: 't1', title: 'Struktur', objective: 'x', acceptanceCriteria: [], status: 'completed', changedFiles: ['src/App.tsx'] }],
    fileManifest: { 'src/App.tsx': 'abc123' },
    lastValidChanges: ['src/App.tsx'],
    previousModelOutput: 'draft',
    executionLogs: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    expiresAt: Date.now() + CHECKPOINT_TTL_MS,
  }
  return { ...base, checksum: checkpointChecksum(base), ...overrides }
}

test('a valid checkpoint round-trips through disk', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'yuha-cp-'))
  const previousCwd = process.cwd()
  process.chdir(dir)
  try {
    const checkpoint = seedCheckpoint()
    await saveCheckpoint(checkpoint)
    const loaded = await loadCheckpointDetailed(checkpoint.checkpointKey)
    assert.equal(loaded?.rejectedBecause, undefined)
    assert.equal(loaded?.checkpoint.workspaceId, 'ws-test')
    assert.equal(loaded?.checkpoint.tasks[0].status, 'completed')
  } finally {
    process.chdir(previousCwd)
    await rm(dir, { recursive: true, force: true })
  }
})

test('a tampered checkpoint fails the integrity checksum and is never resumed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'yuha-cp-'))
  const previousCwd = process.cwd()
  process.chdir(dir)
  try {
    const checkpoint = seedCheckpoint()
    await saveCheckpoint(checkpoint)
    // Tamper: same file, changed tasks, stale checksum.
    const tampered: TaskCheckpoint = { ...checkpoint, tasks: [...checkpoint.tasks, { taskId: 't2', title: 'Fake', objective: 'y', acceptanceCriteria: [], status: 'completed', changedFiles: [] }] }
    await saveCheckpoint(tampered)
    const loaded = await loadCheckpointDetailed(checkpoint.checkpointKey)
    assert.equal(loaded?.rejectedBecause, 'checksum_mismatch')
  } finally {
    process.chdir(previousCwd)
    await rm(dir, { recursive: true, force: true })
  }
})

test('an expired checkpoint is rejected as expired', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'yuha-cp-'))
  const previousCwd = process.cwd()
  process.chdir(dir)
  try {
    const expired = seedCheckpoint({ expiresAt: Date.now() - 1000 })
    await saveCheckpoint(expired)
    const loaded = await loadCheckpointDetailed(expired.checkpointKey)
    assert.equal(loaded?.rejectedBecause, 'expired')
  } finally {
    process.chdir(previousCwd)
    await rm(dir, { recursive: true, force: true })
  }
})

/* ---------- 6.2 Import resolver ---------- */

const FILES: Record<string, string> = {
  'src/App.tsx': `import Card from './components/Card'\nimport utils from './lib/utils'\nimport deep from './components/nested/deep'\nimport alias from '@/hooks/useThing'\nimport pkg from 'react'\n`,
  'src/components/Card.tsx': `export default 1`,
  'src/components/nested/deep.ts': `export default 2`,
  'src/hooks/useThing.js': `export default 3`,
  'src/lib/utils/index.ts': `export default 4`,
}

test('relative imports resolve from the IMPORTER directory, not the workspace root', () => {
  assert.equal(resolveImportPath('src/App.tsx', './components/Card', FILES), 'src/components/Card.tsx')
  // './lib/utils' from src/App.tsx → src/lib/utils (a directory with index.ts)
  assert.equal(resolveImportPath('src/App.tsx', './lib/utils', FILES), 'src/lib/utils/index.ts')
  assert.equal(resolveImportPath('src/App.tsx', './components/nested/deep', FILES), 'src/components/nested/deep.ts')
})

test('nested upward relative imports resolve correctly', () => {
  const nested: Record<string, string> = {
    'src/a/b/c/mod.ts': '',
    'src/a/shared.ts': '',
    'src/a/other.ts': '',
  }
  assert.equal(resolveImportPath('src/a/b/c/mod.ts', '../../shared', nested), 'src/a/shared.ts')
  // Mixed dot segments follow Node semantics exactly: c/.. → b, b/.. → a,
  // then "a/shared" → src/a/a/shared (which does not exist) — null is CORRECT.
  assert.equal(resolveImportPath('src/a/b/c/mod.ts', '.././../a/shared', nested), null)
  assert.equal(resolveImportPath('src/a/b/c/mod.ts', '../../../a/shared', nested), 'src/a/shared.ts')
  assert.equal(resolveImportPath('src/a/b/c/mod.ts', '../../../a/other', nested), 'src/a/other.ts')
})

test('@/ alias maps to src/ with extension and index strategies', () => {
  assert.equal(resolveImportPath('src/App.tsx', '@/hooks/useThing', FILES), 'src/hooks/useThing.js')
  assert.equal(resolveImportPath('src/App.tsx', '@/lib/utils', FILES), 'src/lib/utils/index.ts')
})

test('external packages resolve as external; missing files stay unresolved', () => {
  assert.equal(resolveImportPath('src/App.tsx', 'react', FILES), '__external__')
  assert.equal(resolveImportPath('src/App.tsx', 'node:fs', FILES), '__external__')
  assert.equal(resolveImportPath('src/App.tsx', './nope/missing', FILES), null)
})

test('resolvedLocalImports finds zero unresolved in the fixture — valid imports are not falsely flagged', () => {
  const { unresolved, resolved } = resolvedLocalImports(FILES)
  assert.deepEqual(unresolved, [])
  assert.equal(resolved, 4)
})

test('circular dependencies do not hang the resolver and are reported resolved', () => {
  const circular: Record<string, string> = {
    'a.ts': `import { b } from './b'\nexport const a = 1\n`,
    'b.ts': `import { a } from './a'\nexport const b = 2\n`,
  }
  const { unresolved } = resolvedLocalImports(circular)
  assert.deepEqual(unresolved, [])
})

test('knowledge graph stores RESOLVED dependency paths', () => {
  const ledger = new ProjectKnowledgeLedger()
  ledger.buildGraphFromFiles(FILES)
  const app = ledger.getNode('src/App.tsx')
  assert.ok(app)
  assert.ok(app.dependencies.includes('src/components/Card.tsx'))
  assert.ok(app.dependencies.includes('src/hooks/useThing.js'))
  assert.ok(app.dependencies.includes('react'), 'external specifier kept verbatim')
})

/* ---------- 6.1 Blueprint gate ---------- */

test('complex prompts REQUIRE user approval and stop with a full blueprint', () => {
  const scope = BlueprintAmbiguityGate.analyzePrompt('Buat marketplace e-commerce lengkap dengan payment gateway, database, auth multi-role, dan dashboard admin')
  assert.equal(scope.complexity, 'complex')
  assert.equal(scope.requiresUserApproval, true)
  const bp = scope.blueprint
  assert.equal(bp.origin, 'heuristic-analyzer')
  for (const field of ['objective', 'siteType', 'targetUsers', 'pages', 'navigation', 'coreFeatures', 'visualDesign', 'technology', 'dataModel', 'apiIntegrations', 'dependencies', 'implementationPlan', 'verificationPlan'] as const) {
    assert.ok(bp[field] !== undefined, `blueprint field ${field} present`)
  }
})

test('simple prompts skip the gate (no unnecessary friction)', () => {
  const scope = BlueprintAmbiguityGate.analyzePrompt('Buat kartu ucapan selamat datang sederhana')
  assert.equal(scope.complexity, 'simple')
  assert.equal(scope.requiresUserApproval, false)
})

/* ---------- 7.1 Verification gate ---------- */

test('verification gate distinguishes PASSED/FAILED honestly and flags failures', () => {
  const good = VerificationGateEngine.verifyWorkspace({ 'src/App.tsx': 'export default 1' })
  assert.notEqual(good.overallStatus, 'Failed')
  const emptyFile = VerificationGateEngine.verifyWorkspace({ 'src/App.tsx': '' })
  assert.equal(emptyFile.overallStatus, 'Failed')
  const noFiles = VerificationGateEngine.verifyWorkspace({})
  assert.equal(noFiles.overallStatus, 'Failed')
})
