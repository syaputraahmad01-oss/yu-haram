/**
 * YUHA 15 FOUNDATIONS TEST SUITE
 * Validates deterministic execution, verification gates, manifest contract,
 * work orders, capability model routing, context governance, and security layers.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  YuhaOrchestrator,
  classifyError,
  DeterministicRepairGate,
  ManifestContractManager,
  CapabilityBasedModelRouter,
  WorkOrderManager,
  VerificationGateEngine,
  IncrementalChangeProtocol,
  ContextPackGovernance,
  DesignSystemValidator,
  ProjectKnowledgeLedger,
  ContinuousEvaluationHarness,
  BlueprintAmbiguityGate,
  BudgetGovernanceManager,
  SandboxSecurityLayer,
  YUHA_15_FOUNDATIONS_STATUS,
} from '../src/lib/foundations'

test('Fondasi 1: AI Orchestrator enforces bounded repair loop and phase transitions', () => {
  const orchestrator = new YuhaOrchestrator('proj-123', 'Build a real-time dashboard', 3)
  assert.equal(orchestrator.getSession().phase, 'idle')

  orchestrator.advancePhase('code_generation', 'User prompt validated')
  assert.equal(orchestrator.getSession().phase, 'code_generation')

  // Simulate 3 failures
  for (let i = 1; i <= 3; i++) {
    const passed = orchestrator.recordVerification({
      id: `vr-${i}`,
      timestamp: Date.now(),
      overallStatus: 'Failed',
      levels: {
        contract: { status: 'Failed' },
        filesystem: { status: 'Passed' },
        typeCheck: { status: 'Passed' },
        build: { status: 'Failed' },
        tests: { status: 'Not Run' },
        runtime: { status: 'Not Run' },
        acceptance: { status: 'Failed' },
      },
    })
    assert.equal(passed, false)
  }

  // Session must transition to failed after exceeding repair limit
  assert.equal(orchestrator.getSession().phase, 'failed')
  assert.equal(orchestrator.canRetryRepair(), false)
})

test('Fondasi 2: Error-Aware Repair Router accurately classifies errors into 10 categories', () => {
  const err429 = classifyError('HTTP 429 Too Many Requests: Rate limit exceeded')
  assert.equal(err429.category, 'provider')
  assert.equal(err429.strategy, 'provider_fallback')

  const secErr = classifyError('Error: directory traversal attempt blocked on ../etc/passwd')
  assert.equal(secErr.category, 'security')
  assert.equal(secErr.strategy, 'circuit_break')

  const depErr = classifyError("Cannot find module '@tanstack/react-query' from 'src/App.tsx'")
  assert.equal(depErr.category, 'dependency')
  assert.equal(depErr.strategy, 'install_missing_dependency')

  const syntaxErr = classifyError('SyntaxError: Unexpected token, expected "}" at line 42')
  assert.equal(syntaxErr.category, 'syntax')
  assert.equal(syntaxErr.strategy, 'deterministic_fix')
})

test('Fondasi 3: Deterministic Repair Gate fixes unbalanced braces without token costs', () => {
  const unclosed = 'export function Button() { return (<button>Click</button>'
  const fix = DeterministicRepairGate.fixUnbalancedBraces(unclosed)
  assert.equal(fix.applied, true)
  assert.ok(fix.updatedContent?.endsWith('\n}'))

  const balanced = 'function test() { return 123; }'
  const balancedFix = DeterministicRepairGate.fixUnbalancedBraces(balanced)
  assert.equal(balancedFix.applied, false)
})

test('Fondasi 4: Manifest-Driven File Contract validates workspace files and detects missing planned items', () => {
  const manifest = ManifestContractManager.createDefaultManifest('my-app')
  const workspace = {
    'package.json': '{}',
    'index.html': '<html></html>',
    'src/main.tsx': 'import React from "react"',
    // Missing 'src/App.tsx' and 'src/index.css'
  }

  const validation = ManifestContractManager.validateContract(manifest, workspace)
  assert.equal(validation.valid, false)
  assert.ok(validation.missingFiles.includes('src/App.tsx'))
  assert.ok(validation.missingFiles.includes('src/index.css'))
})

test('Fondasi 5: Capability-Based Model Router requires caller-supplied evidence and enforces Free-First', () => {
  const candidates = [
    { modelId: 'fixture-free-coder', provider: 'openrouter' as const, codingScore: 92, reasoningScore: 88, contextWindow: 32_000, tier: 'free' as const, verifiedFree: true, isLocal: false },
    { modelId: 'fixture-unknown-cloud', provider: 'gemini' as const, codingScore: 99, reasoningScore: 99, contextWindow: 128_000, tier: 'unknown' as const, verifiedFree: false, isLocal: false },
  ]
  const bestFreeCoder = CapabilityBasedModelRouter.selectBestModelForTask('coding', candidates, { allowPaid: false })
  assert.equal(bestFreeCoder?.modelId, 'fixture-free-coder')
  const noFreeCandidate = CapabilityBasedModelRouter.selectBestModelForTask('planning', [candidates[1]], { allowPaid: false })
  assert.equal(noFreeCandidate, null)
  const explicitConsent = CapabilityBasedModelRouter.selectBestModelForTask('planning', [candidates[1]], { allowPaid: true })
  assert.equal(explicitConsent?.modelId, 'fixture-unknown-cloud')
  const invalidEvidence = CapabilityBasedModelRouter.selectBestModelForTask('coding', [{ ...candidates[0], codingScore: 1000 }], { allowPaid: false })
  assert.equal(invalidEvidence, null)
})

test('Fondasi 6: Work Order Protocol manages task dependencies and topological execution order', () => {
  const manager = new WorkOrderManager()

  const wo1 = manager.createOrder({
    type: 'generate_file',
    title: 'Create Types',
    objective: 'Define data models in types.ts',
    scope: ['src/types.ts'],
    affectedFiles: ['src/types.ts'],
    acceptanceCriteria: ['Valid typescript definitions'],
  })

  const wo2 = manager.createOrder({
    type: 'generate_file',
    title: 'Create Component',
    objective: 'Build component using types.ts',
    scope: ['src/Card.tsx'],
    dependencies: [wo1.id],
    affectedFiles: ['src/Card.tsx'],
    acceptanceCriteria: ['Imports types from types.ts'],
  })

  // Initially only wo1 is executable
  let executable = manager.getExecutableOrders()
  assert.equal(executable.length, 1)
  assert.equal(executable[0].id, wo1.id)

  // Mark wo1 complete
  manager.updateStatus(wo1.id, 'completed', 'Types generated successfully')

  // Now wo2 becomes executable
  executable = manager.getExecutableOrders()
  assert.equal(executable.length, 1)
  assert.equal(executable[0].id, wo2.id)
})

test('Fondasi 7: Acceptance-Driven Verification Gate executes 7 levels and requires proof', () => {
  const files = {
    'package.json': '{"name":"test"}',
    'index.html': '<html><body><div id="root"></div></body></html>',
    'src/main.tsx': 'console.log("ready")',
  }

  const report = VerificationGateEngine.verifyWorkspace(files, undefined, ['Must run in browser'])
  assert.equal(report.overallStatus, 'Partially Verified')
  assert.equal(report.levels.filesystem.status, 'Passed')
  assert.equal(report.levels.build.status, 'Not Run')
  assert.equal(report.levels.tests.status, 'Not Run')
  assert.equal(report.levels.runtime.status, 'Not Run')
  assert.equal(report.levels.acceptance.status, 'Blocked')

  // Empty workspace must fail verification
  const emptyReport = VerificationGateEngine.verifyWorkspace({})
  assert.equal(emptyReport.overallStatus, 'Failed')
  assert.equal(emptyReport.levels.filesystem.status, 'Failed')
})

test('Fondasi 8: Incremental Change Protocol limits impact scope to target files', () => {
  const files = {
    'src/App.tsx': 'export function App() {}',
    'src/Button.tsx': 'export function Button() {}',
    'src/index.css': 'body { margin: 0; }',
    'package.json': '{}',
  }

  const analysis = IncrementalChangeProtocol.analyzeChangeImpact('Change the button background to blue', files)
  assert.ok(analysis.targetFiles.includes('src/Button.tsx') || analysis.targetFiles.includes('src/index.css'))
  assert.ok(analysis.unaffectedFiles.includes('package.json'))
})

test('Fondasi 9: Context Pack Governance redacts credentials and blocks .env files', () => {
  const filesWithSecrets = {
    'package.json': '{"name":"app"}',
    'src/api.ts': 'const key = "AIzaSyD9876543210123456789012345678901";',
    '.env': 'DATABASE_URL="postgres://user:password@localhost/db"',
    '.env.example': 'DATABASE_URL="postgres://user:password@localhost/db"',
  }

  const pack = ContextPackGovernance.buildContextPack(filesWithSecrets)
  assert.ok(!pack.includedFiles.includes('.env'), '.env must be excluded from context')
  assert.ok(pack.includedFiles.includes('.env.example'), '.env.example template may be included')
  assert.ok(pack.renderedPromptContext.includes('[REDACTED_SECRET]'), 'API key must be redacted')
  assert.ok(!pack.renderedPromptContext.includes('AIzaSyD9876543210123456789012345678901'))
})

test('Fondasi 10: Design System Validator catches accessibility and touch target violations', () => {
  const accessibleCode = '<button aria-label="Submit Form" className="min-h-[44px]">Submit</button>'
  const auditGood = DesignSystemValidator.auditUIQuality('src/Button.tsx', accessibleCode)
  assert.equal(auditGood.violations.length, 0)
  assert.equal(auditGood.score, 100)

  const inaccessibleCode = '<img src="logo.png" />\n<button><svg /></button>'
  const auditBad = DesignSystemValidator.auditUIQuality('src/Header.tsx', inaccessibleCode)
  assert.ok(auditBad.violations.length >= 2)
  assert.ok(auditBad.score < 80)
})

test('Fondasi 11: Project Knowledge Graph & Evidence Ledger records verifiable proofs', () => {
  const ledger = new ProjectKnowledgeLedger()
  const record = ledger.recordEvidence({
    action: 'BUILD_VERIFICATION',
    actor: 'VerificationGateEngine',
    inputs: { filesCount: 5 },
    outputs: { exitCode: 0 },
    verified: true,
    proof: 'Process exited with code 0. Diagnostic clean.',
  })

  assert.equal(record.verified, true)
  assert.equal(ledger.getLedger().length, 1)
})

test('Fondasi 12: Continuous Evaluation Harness evaluates benchmarks and detects anti-patterns', () => {
  const task = ContinuousEvaluationHarness.STANDARD_BENCHMARKS[0] // React Counter
  const goodCode = 'export function Counter() { const [count, setCount] = useState(0); return <button aria-label="Inc" aria-live="polite">Add</button> }'

  const result = ContinuousEvaluationHarness.evaluateOutput(task, 'gemini-2.5-flash', goodCode, 250)
  assert.equal(result.passed, true)
  assert.ok(result.score >= 70)
})

test('Fondasi 13: Blueprint Ambiguity Gate classifies prompt complexity across 7 dimensions', () => {
  const simplePrompt = 'Change the background to dark blue'
  const contractSimple = BlueprintAmbiguityGate.analyzePrompt(simplePrompt)
  assert.equal(contractSimple.complexity, 'simple')
  assert.equal(contractSimple.requiresUserApproval, false)

  const complexPrompt = 'Build a multi-vendor ecommerce marketplace with database, Stripe payments, and user auth'
  const contractComplex = BlueprintAmbiguityGate.analyzePrompt(complexPrompt)
  assert.equal(contractComplex.complexity, 'complex')
  assert.ok(contractComplex.ambiguities.length >= 2)
})

test('Fondasi 14: Budget Governance Manager trips circuit breaker on consecutive errors', () => {
  const budget = new BudgetGovernanceManager(3, 100_000)
  assert.equal(budget.getStatus().isCircuitBreakerTripped, false)

  budget.recordFailure('Timeout 1')
  budget.recordFailure('Timeout 2')
  const tripped = budget.recordFailure('Timeout 3')

  assert.equal(tripped, true)
  assert.equal(budget.getStatus().isCircuitBreakerTripped, true)
  assert.throws(() => budget.recordRequest(100), /Circuit breaker is TRIPPED/)
  assert.ok((budget.getStatus().lastFailureTime ?? 0) > 0)
})

test('Fondasi 14: Budget Governance rejects invalid estimates and enforces its per-request ceiling', () => {
  const budget = new BudgetGovernanceManager(2, 100)
  budget.recordRequest(60)
  assert.deepEqual(
    { requests: budget.getStatus().totalRequests, tokens: budget.getStatus().totalTokensUsed },
    { requests: 1, tokens: 60 },
  )

  for (const invalid of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => budget.recordRequest(invalid), /tokensEstimated/)
  }
  assert.throws(() => budget.recordRequest(41), /estimate exceeded/)
  assert.equal(budget.getStatus().isCircuitBreakerTripped, true)
  assert.equal(budget.getStatus().totalRequests, 1)
  assert.equal(budget.getStatus().totalTokensUsed, 60)
  assert.throws(() => new BudgetGovernanceManager(0, 100), /maxConsecutiveFailures/)
  assert.throws(() => new BudgetGovernanceManager(3, Number.POSITIVE_INFINITY), /maxTokensPerSession/)
})

test('Fondasi 15: Sandboxed Execution Layer enforces strict path traversal and SSRF protections', () => {
  // Path traversal checks
  assert.equal(SandboxSecurityLayer.validatePath('../etc/passwd').allowed, false)
  assert.equal(SandboxSecurityLayer.validatePath('src/../../root').allowed, false)
  assert.equal(SandboxSecurityLayer.validatePath('C:\\Windows\\System32').allowed, false)
  assert.equal(SandboxSecurityLayer.validatePath('src/components/Button.tsx').allowed, true)

  // Command lifecycle scripts check
  const cmdCheck = SandboxSecurityLayer.validateNpmCommand('npm install axios')
  assert.equal(cmdCheck.allowed, true)
  assert.ok(cmdCheck.sanitizedValue?.includes('--ignore-scripts'))

  // SSRF check
  assert.equal(SandboxSecurityLayer.validateNetworkEgress('http://169.254.169.254/latest/meta-data/').allowed, false)
  assert.equal(SandboxSecurityLayer.validateNetworkEgress('http://192.168.1.1/admin').allowed, false)
  assert.equal(SandboxSecurityLayer.validateNetworkEgress('https://api.github.com/repos').allowed, true)
})

test('Registry: All 15 Foundations are registered without unsupported verified claims', () => {
  assert.equal(YUHA_15_FOUNDATIONS_STATUS.length, 15)
  for (const f of YUHA_15_FOUNDATIONS_STATUS) {
    assert.notEqual(f.status, 'implemented_verified')
    assert.ok(f.evidence.length > 5)
  }
})
