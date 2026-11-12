/**
 * E2E WEBSITE GENERATION — Master Prompt 17.5 Tests A–E + repair/resume paths.
 *
 * Provider: MOCKED Ollama-compatible server on the documented loopback address
 * (tests/helpers/mock-ollama.ts). The REAL production pipeline is exercised
 * end-to-end: rate limits, CSRF guard, free-tier policy, blueprint approval
 * gate, planner/coder orchestration, sandbox path validation, deterministic
 * repair, structured `files` events, checkpoint persistence/resume, the
 * verification gate, and NDJSON streaming through the production consumer.
 *
 * HONESTY (Master 17.3): these results are MOCKED, not LIVE. They prove the
 * PIPELINE works end-to-end; they do not prove any real model's capability,
 * and the Install/Run/Preview stages (WebContainer) run in the user's browser,
 * not on this server — see YUHA_MASTER_UPGRADE_REPORT.md.
 */

import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Server } from 'node:http'

import { startMockOllama, closeMockOllama, createMockControl, MOCK_MODEL, type MockControl } from './helpers/mock-ollama'
import { E2E_SCENARIOS, E2E_PROMPTS } from './helpers/e2e-projects'
import { consumeAIStream } from '../src/lib/ai/stream'
import { parseAIResponseActions, parseSafeNpmCommand } from '../src/lib/ai/parser'
import { resetRateLimitsForTests } from '../src/lib/security/rate-limit'
import { resetCircuitBreakers } from '../src/lib/ai/fallback-policy'
import type { ParsedFile } from '../src/types'

// Imported dynamically AFTER the chdir into a temp dir so the checkpoint
// store (.data/checkpoints, resolved from process.cwd() at module load)
// never touches the real workspace data.
type RoutePost = (request: Request) => Promise<Response>
let orchestratePOST: RoutePost
let chatPOST: RoutePost
let providersPOST: RoutePost
let loadCheckpointDetailed: typeof import('../src/lib/foundations/task-checkpoint').loadCheckpointDetailed
let deriveCheckpointKey: typeof import('../src/lib/foundations/task-checkpoint').deriveCheckpointKey

let control: MockControl
let server: Server
let tempDir: string
let previousCwd: string

before(async () => {
  previousCwd = process.cwd()
  tempDir = await mkdtemp(join(tmpdir(), 'yuha-e2e-'))
  process.chdir(tempDir)
  orchestratePOST = (await import('../src/app/api/orchestrate/route')).POST
  chatPOST = (await import('../src/app/api/chat/route')).POST
  providersPOST = (await import('../src/app/api/providers/route')).POST
  const checkpointModule = await import('../src/lib/foundations/task-checkpoint')
  loadCheckpointDetailed = checkpointModule.loadCheckpointDetailed
  deriveCheckpointKey = checkpointModule.deriveCheckpointKey
  control = createMockControl(E2E_SCENARIOS)
  server = await startMockOllama(control)
})

after(async () => {
  await closeMockOllama(server)
  process.chdir(previousCwd)
  await rm(tempDir, { recursive: true, force: true })
})

beforeEach(() => {
  resetRateLimitsForTests()
  resetCircuitBreakers()
})

/* ------------------------------------------------------------------ */
/* Driver helpers                                                      */
/* ------------------------------------------------------------------ */

interface StreamOutcome {
  status: number
  events: Array<Record<string, any>>
  text: string
  streamError: string | null
  notices: string[]
  workspace: Record<string, string>
  serverFiles: ParsedFile[]
}

async function readStream(response: Response): Promise<Omit<StreamOutcome, 'status'>> {
  const events: Array<Record<string, any>> = []
  let text = ''
  let streamError: string | null = null
  try {
    await consumeAIStream(response, {
      onEvent: event => { events.push(event) },
      onDelta: delta => { text += delta },
    })
  } catch (error) {
    streamError = error instanceof Error ? error.message : String(error)
  }
  const notices = events.filter(event => event.type === 'notice').map(event => String(event.message))
  const serverFiles: ParsedFile[] = []
  for (const event of events) {
    if (event.type !== 'files' || !Array.isArray(event.files)) continue
    for (const candidate of event.files) {
      if (candidate && typeof candidate.path === 'string' && typeof candidate.content === 'string') {
        serverFiles.push({ path: candidate.path, content: candidate.content, language: typeof candidate.language === 'string' ? candidate.language : undefined })
      }
    }
  }
  const workspace: Record<string, string> = {}
  for (const file of serverFiles) workspace[file.path] = file.content
  return { events, text, streamError, notices, workspace, serverFiles }
}

async function callOrchestrate(body: Record<string, unknown>): Promise<StreamOutcome> {
  const request = new Request('http://localhost:3000/api/orchestrate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'sec-fetch-site': 'same-origin' },
    body: JSON.stringify(body),
  })
  const response = await orchestratePOST(request)
  return { status: response.status, ...(await readStream(response)) }
}

/** Mirror the real client: a blueprint gate answer is resent with
 *  blueprintApproved once the (simulated) user approves. */
async function runPipeline(
  prompt: string,
  workspaceId: string,
  options: { messages?: Array<{ role: string; content: string }>; files?: Record<string, string> } = {},
): Promise<{ gated: boolean; first: StreamOutcome; final: StreamOutcome }> {
  const messages = options.messages ?? [{ role: 'user', content: prompt }]
  const base = { provider: 'ollama', model: MOCK_MODEL, mode: 'balanced' as const, workspaceId }
  const first = await callOrchestrate({ ...base, messages, files: options.files ?? {} })
  if (!first.events.some(event => event.type === 'blueprint')) {
    return { gated: false, first, final: first }
  }
  const final = await callOrchestrate({ ...base, messages, files: options.files ?? {}, blueprintApproved: true })
  return { gated: true, first, final }
}

function braceDelta(code: string): number {
  let delta = 0
  let inString = false
  let stringChar = ''
  for (let i = 0; i < code.length; i += 1) {
    const char = code[i]
    if (inString) {
      if (char === stringChar && code[i - 1] !== '\\') inString = false
      continue
    }
    if (char === '"' || char === "'" || char === '`') { inString = true; stringChar = char; continue }
    if (char === '{') delta += 1
    else if (char === '}') delta -= 1
  }
  return delta
}

function assertHealthyPipeline(outcome: StreamOutcome, plannedTasks: number, completedTasks = plannedTasks) {
  const stageEvents = outcome.events.filter(event => event.type === 'stage')
  assert.deepEqual(
    stageEvents.map(event => event.stage),
    ['planning', ...Array.from({ length: completedTasks }, () => 'coding')],
    'stage sequence must be planning then one coding stage per executed task',
  )
  for (const stage of stageEvents) {
    assert.equal(stage.provider, 'ollama', 'stage events must show the active provider')
    assert.equal(stage.model, MOCK_MODEL, 'stage events must show the active model')
  }

  const plan = outcome.events.find(event => event.type === 'agent-plan')
  assert.ok(plan, 'agent-plan event must be emitted')
  assert.equal(plan.tasks.length, plannedTasks, 'planner plan must reach the client')

  assert.equal(
    outcome.events.filter(event => event.type === 'agent-task-complete').length,
    completedTasks,
    'every executed task must report completion',
  )

  const verification = outcome.events.find(event => event.type === 'verification')?.report
  assert.ok(verification, 'verification report must be emitted')
  assert.equal(verification.overallStatus, 'Partially Verified', 'static-only verification is honestly Partially Verified')
  assert.equal(verification.levels.filesystem.status, 'Passed')
  assert.equal(verification.levels.contract.status, 'Passed')
  // Honesty: levels that did not run are never reported as passed.
  assert.equal(verification.levels.typeCheck.status, 'Not Run')
  assert.equal(verification.levels.build.status, 'Not Run')
  assert.equal(verification.levels.tests.status, 'Not Run')
  assert.equal(verification.levels.runtime.status, 'Not Run')

  const meta = outcome.events.find(event => event.type === 'meta')
  assert.ok(meta, 'meta event with the role/model list must be emitted')
  assert.deepEqual(
    meta.roles.map((role: any) => role.role),
    ['coder', 'planner'],
  )

  const done = outcome.events[outcome.events.length - 1]
  assert.equal(done.type, 'done')
  assert.equal(done.verificationFailed, false)
  assert.equal(done.verification?.overallStatus, 'Partially Verified')
  assert.equal(outcome.streamError, null)
}

const MANIFEST_REQUIRED = ['package.json', 'index.html', 'src/main.tsx', 'src/App.tsx', 'src/index.css']

function assertNpmInstallCommand(outcome: StreamOutcome) {
  const commands = parseAIResponseActions(outcome.text).commands
  assert.ok(commands.includes('npm install'), `shell actions must include npm install (got: ${commands.join(', ')})`)
  const safe = parseSafeNpmCommand('npm install')
  assert.deepEqual(safe?.args, ['install', '--ignore-scripts'], 'executor validation must force --ignore-scripts')
}

/* ------------------------------------------------------------------ */
/* Test A — Landing Page (simple prompt, no blueprint gate)            */
/* ------------------------------------------------------------------ */

test('Test A — landing page: Prompt → Plan → Generate → Verify without gate (MOCKED)', async () => {
  const { gated, final } = await runPipeline(E2E_PROMPTS.testA, 'e2e-a')
  assert.equal(gated, false, 'a simple landing-page prompt must not trigger the blueprint gate')

  assertHealthyPipeline(final, 1)
  assertNpmInstallCommand(final)

  for (const path of [...MANIFEST_REQUIRED, 'src/components/Navbar.tsx', 'src/components/Hero.tsx', 'src/components/Features.tsx', 'src/components/Pricing.tsx', 'src/components/Footer.tsx']) {
    assert.ok(final.workspace[path], `workspace must contain ${path}`)
  }
  for (const marker of ['Navbar', 'Hero', 'Features', 'Pricing', 'Footer']) {
    assert.match(final.workspace['src/App.tsx'], new RegExp(marker), `App must compose ${marker}`)
  }
  assert.match(final.workspace['src/index.css'], /@media/, 'landing CSS must be responsive')
  assert.match(final.workspace['src/components/Pricing.tsx'], /plan|harga/i, 'pricing section must exist')
})

/* ------------------------------------------------------------------ */
/* Test B — Admin Dashboard (complex: gate must block, then binding)   */
/* ------------------------------------------------------------------ */

test('Test B — admin dashboard: blueprint gate blocks generation until approved (MOCKED)', async () => {
  const base = { provider: 'ollama', model: MOCK_MODEL, mode: 'balanced' as const, workspaceId: 'e2e-b' }
  const messages = [{ role: 'user', content: E2E_PROMPTS.testB }]

  // The gated first call does NO model work and produces NO code.
  const callsBefore = control.calls.length
  const first = await callOrchestrate({ ...base, messages, files: {} })
  assert.equal(control.calls.length, callsBefore, 'the gated call must not consume any provider request')

  const firstTypes = first.events.map(event => event.type)
  assert.ok(firstTypes.includes('blueprint'))
  assert.ok(!firstTypes.includes('stage'), 'no stage may start before approval')
  assert.ok(!firstTypes.includes('delta'), 'no code may stream before approval')
  assert.equal(first.events[first.events.length - 1].type, 'done')
  assert.equal(first.events[first.events.length - 1].gate, 'blueprint')
  assert.equal(control.calls.length, callsBefore, 'the gated call must not consume any provider request')

  const gate = first.events.find(event => event.type === 'blueprint')
  assert.ok(gate, 'blueprint event must carry the blueprint payload')
  assert.equal(gate.complexity, 'complex')
  for (const field of ['objective', 'siteType', 'pages', 'coreFeatures']) {
    assert.ok(gate.blueprint[field] !== undefined, `blueprint must expose ${field} (Master 6.1)`)
  }

  const gateKey = deriveCheckpointKey(E2E_PROMPTS.testB, 'ollama', MOCK_MODEL, 'e2e-b')
  const stored = await loadCheckpointDetailed(gateKey)
  assert.equal(stored?.checkpoint?.status, 'waiting_for_user', 'gate checkpoint is waiting_for_user')

  // The approved run binds the blueprint and completes the pipeline.
  const final = await callOrchestrate({ ...base, messages, files: {}, blueprintApproved: true })
  assert.ok(final.notices.some(notice => notice.includes('Blueprint disetujui')), 'approval notice must be shown')
  assertHealthyPipeline(final, 2)
  assertNpmInstallCommand(final)

  for (const path of [...MANIFEST_REQUIRED, 'src/components/Sidebar.tsx', 'src/components/StatCards.tsx', 'src/components/DataTable.tsx', 'src/components/UserForm.tsx', 'src/types.ts']) {
    assert.ok(final.workspace[path], `workspace must contain ${path}`)
  }
  assert.match(final.workspace['src/components/DataTable.tsx'], /type="search"/, 'table must offer search')
  assert.match(final.workspace['src/components/DataTable.tsx'], /pagination|Halaman/, 'table must paginate')
  assert.match(final.workspace['src/components/DataTable.tsx'], /option value="semua"|Filter status|filter/, 'table must filter')
  assert.match(final.workspace['src/components/UserForm.tsx'], /role="alert"/, 'form must surface validation errors')

  const finished = await loadCheckpointDetailed(gateKey)
  assert.equal(finished?.checkpoint?.status, 'completed', 'checkpoint completes after a healthy approved run')
})

/* ------------------------------------------------------------------ */
/* Test C — Inventory Management (gate + CRUD/validation/persistence)  */
/* ------------------------------------------------------------------ */

test('Test C — inventory management: CRUD, validation, status, data consistency (MOCKED)', async () => {
  const { gated, final } = await runPipeline(E2E_PROMPTS.testC, 'e2e-c')
  assert.equal(gated, true, 'inventory management is complex and must be gated')

  assertHealthyPipeline(final, 2)

  for (const path of [...MANIFEST_REQUIRED, 'src/types.ts', 'src/storage.ts', 'src/components/ItemTable.tsx', 'src/components/ItemForm.tsx']) {
    assert.ok(final.workspace[path], `workspace must contain ${path}`)
  }
  assert.match(final.workspace['src/types.ts'], /deriveStatus/, 'status must be derived, never hardcoded')
  assert.match(final.workspace['src/storage.ts'], /localStorage/, 'data must persist in localStorage')
  assert.match(final.workspace['src/storage.ts'], /validateItem/, 'validation layer must exist')
  assert.match(final.workspace['src/storage.ts'], /JSON\.parse/, 'loads must parse stored data')
  assert.match(final.workspace['src/components/ItemForm.tsx'], /role="alert"/, 'form errors must be announced')
  assert.match(final.workspace['src/components/ItemTable.tsx'], /onDelete|onRestock/, 'CRUD actions must be wired')
})

/* ------------------------------------------------------------------ */
/* Test D — Company Profile (moderate: no gate, multi-page + form)     */
/* ------------------------------------------------------------------ */

test('Test D — company profile: multi-page, navigation, contact form (MOCKED)', async () => {
  const { gated, final } = await runPipeline(E2E_PROMPTS.testD, 'e2e-d')
  assert.equal(gated, false, 'a moderate company profile must not pay the gate friction')

  assertHealthyPipeline(final, 2)

  for (const path of [...MANIFEST_REQUIRED, 'src/components/Navbar.tsx', 'src/pages/HomePage.tsx', 'src/pages/ServicesPage.tsx', 'src/pages/AboutPage.tsx', 'src/pages/ContactPage.tsx']) {
    assert.ok(final.workspace[path], `workspace must contain ${path}`)
  }
  assert.match(final.workspace['src/App.tsx'], /Page = 'beranda' \| 'layanan' \| 'tentang' \| 'kontak'/, 'four pages must be routable')
  assert.match(final.workspace['src/components/Navbar.tsx'], /aria-current/, 'navigation must mark the active page')
  assert.match(final.workspace['src/pages/ContactPage.tsx'], /role="alert"/, 'contact form must validate')
  assert.match(final.workspace['src/index.css'], /@media/, 'profile must be responsive')
})

/* ------------------------------------------------------------------ */
/* Test E — Complex Website (gate + routes/state/API/error handling)   */
/* ------------------------------------------------------------------ */

test('Test E — complex marketplace: routes, state, API integration, error handling (MOCKED)', async () => {
  const { gated, final } = await runPipeline(E2E_PROMPTS.testE, 'e2e-e')
  assert.equal(gated, true, 'a marketplace prompt is complex and must be gated')

  assertHealthyPipeline(final, 3)

  for (const path of [...MANIFEST_REQUIRED, 'src/types.ts', 'src/api.ts', 'src/cart.tsx', 'src/components/ProductList.tsx', 'src/components/ErrorBoundary.tsx', 'src/pages/MarketplacePage.tsx']) {
    assert.ok(final.workspace[path], `workspace must contain ${path}`)
  }
  assert.match(final.workspace['src/api.ts'], /class ApiError/, 'API layer must classify errors')
  assert.match(final.workspace['src/api.ts'], /AbortSignal/, 'API layer must honour cancellation')
  assert.match(final.workspace['src/cart.tsx'], /useReducer/, 'state management must use a reducer')
  assert.match(final.workspace['src/components/ErrorBoundary.tsx'], /getDerivedStateFromError/, 'error boundary must catch render errors')
  assert.match(final.workspace['src/pages/MarketplacePage.tsx'], /role="status"[\s\S]*Memuat|loading/i, 'loading state must be explicit')
  assert.match(final.workspace['src/pages/MarketplacePage.tsx'], /CheckoutPage/, 'multiple routes must exist')

  const eCalls = control.calls.filter(call => call.scenario === 'test-e-marketplace')
  assert.equal(eCalls.filter(call => call.role === 'planner').length, 1, 'planner ran once for the approved run')
  assert.equal(eCalls.filter(call => call.role === 'coder').length, 3, 'one coder call per task')
})

/* ------------------------------------------------------------------ */
/* Deterministic repair: raw draft is broken, workspace gets the fix   */
/* ------------------------------------------------------------------ */

test('Repair — deterministic brace fix reaches the workspace, not just the checkpoint (MOCKED)', async () => {
  const { gated, final } = await runPipeline(E2E_PROMPTS.testF, 'e2e-f')
  assert.equal(gated, false)

  assert.ok(
    final.notices.some(notice => notice.includes('Deterministic repair')),
    'an applied repair must be announced, never silent',
  )

  // The raw transcript still shows what the model actually produced…
  const rawFiles = parseAIResponseActions(final.text).files
  const rawApp = rawFiles.find(file => file.path === 'src/App.tsx')
  assert.ok(rawApp, 'raw draft contains App.tsx')
  assert.notEqual(braceDelta(rawApp.content), 0, 'the mock deliberately sent an unbalanced file')

  // …but the structured files event (what the client applies, and what the
  // verification gate validated) carries the REPAIRED content.
  const fixedApp = final.workspace['src/App.tsx']
  assert.ok(fixedApp, 'workspace receives App.tsx')
  assert.equal(braceDelta(fixedApp), 0, 'workspace file must be brace-balanced after deterministic repair')

  const verification = final.events.find(event => event.type === 'verification')?.report
  assert.equal(verification.overallStatus, 'Partially Verified')
  assert.equal(final.events[final.events.length - 1].verificationFailed, false)
})

/* ------------------------------------------------------------------ */
/* Verification gate refuses COMPLETED on a broken contract            */
/* ------------------------------------------------------------------ */

test('Verification gate — missing manifest file keeps the run FAILED, then a repair turn fixes it (MOCKED)', async () => {
  const turn1 = await callOrchestrate({
    provider: 'ollama', model: MOCK_MODEL, mode: 'balanced', workspaceId: 'e2e-g',
    messages: [{ role: 'user', content: E2E_PROMPTS.testG }], files: {},
  })

  assert.equal(turn1.events[turn1.events.length - 1].type, 'done')
  const verification = turn1.events.find(event => event.type === 'verification')?.report
  assert.equal(verification.overallStatus, 'Failed', 'a missing manifest file must FAIL verification')
  assert.equal(verification.levels.contract.status, 'Failed')
  assert.ok(turn1.notices.some(notice => notice.includes('src/App.tsx')), 'the missing file is named in the notice')
  assert.ok(turn1.notices.some(notice => notice.includes('import lokal')), 'the unresolved import is reported')
  assert.equal(turn1.events[turn1.events.length - 1].verificationFailed, true, 'done event must carry verificationFailed=true')

  const key1 = deriveCheckpointKey(E2E_PROMPTS.testG, 'ollama', MOCK_MODEL, 'e2e-g')
  const stored1 = await loadCheckpointDetailed(key1)
  assert.equal(stored1?.checkpoint?.status, 'interrupted', 'a failed verification must NOT be stored as completed')
  assert.match(String(stored1?.checkpoint?.failureReason), /Verification gate FAILED/)

  // --- Repair turn: the user (via the browser) sends the current workspace
  // back and asks for the missing file. The same pipeline must now pass.
  const repair = await callOrchestrate({
    provider: 'ollama', model: MOCK_MODEL, mode: 'balanced', workspaceId: 'e2e-g',
    messages: [
      { role: 'user', content: E2E_PROMPTS.testG },
      { role: 'assistant', content: turn1.text.slice(0, 60_000) },
      { role: 'user', content: E2E_PROMPTS.testGRepair },
    ],
    files: turn1.workspace,
  })

  const verification2 = repair.events.find(event => event.type === 'verification')?.report
  assert.equal(verification2.overallStatus, 'Partially Verified', 'the repaired project must pass static verification')
  assert.equal(repair.events[repair.events.length - 1].verificationFailed, false)
  assert.ok(repair.workspace['src/App.tsx'], 'the repair turn adds the missing file')
  assert.match(repair.workspace['src/App.tsx'], /Checklist Harian Tim/)
})

/* ------------------------------------------------------------------ */
/* Checkpoint resume: a failed task is not redone from scratch         */
/* ------------------------------------------------------------------ */

test('Resume — a mid-run failure continues from the checkpoint without redoing finished tasks (MOCKED)', async () => {
  // Coder call #1 (task 1) succeeds; calls #2/#3 (task 2 + its retry) fail.
  control.failCoderCalls = [2, 3]

  const run1 = await callOrchestrate({
    provider: 'ollama', model: MOCK_MODEL, mode: 'balanced', workspaceId: 'e2e-h',
    messages: [{ role: 'user', content: E2E_PROMPTS.testH }], files: {},
  })

  assert.equal(run1.events[run1.events.length - 1].type, 'done', 'partial work still ends with done, keeping finished output')
  assert.ok(run1.workspace['package.json'], 'task 1 files were already delivered to the client')
  assert.ok(!run1.workspace['src/components/Announcements.tsx'], 'task 2 did not complete in the failing run')
  assert.ok(
    run1.notices.some(notice => notice.includes('gagal') || notice.includes('Retry')),
    'the failure and retry are surfaced, never hidden',
  )

  const key = deriveCheckpointKey(E2E_PROMPTS.testH, 'ollama', MOCK_MODEL, 'e2e-h')
  const stored = await loadCheckpointDetailed(key)
  assert.equal(stored?.checkpoint?.status, 'interrupted')
  assert.equal(stored?.checkpoint?.tasks?.[0]?.status, 'completed')
  assert.notEqual(stored?.checkpoint?.tasks?.[1]?.status, 'completed')

  // Recovery: same instruction, same workspace → only the unfinished task runs.
  // The real client already applied task 1's files to its workspace, so the
  // retry carries them (the browser is the source of truth for file state).
  control.failCoderCalls = []
  const run2 = await callOrchestrate({
    provider: 'ollama', model: MOCK_MODEL, mode: 'balanced', workspaceId: 'e2e-h',
    messages: [{ role: 'user', content: E2E_PROMPTS.testH }], files: run1.workspace,
  })

  assert.ok(
    run2.notices.some(notice => notice.includes('Checkpoint dipulihkan')),
    'the resume must announce that finished tasks are not redone',
  )
  // The resumed run plans both tasks but only EXECUTES the unfinished one.
  assertHealthyPipeline(run2, 2, 1)
  assert.ok(run2.workspace['src/components/Announcements.tsx'], 'the resumed run completes the missing feature')

  const hCalls = control.calls.filter(call => call.scenario === 'test-h-resume' && call.role === 'coder')
  assert.equal(hCalls.length, 4, 'exactly: task1 + two failed attempts + the single resumed task-2 call')
})

/* ------------------------------------------------------------------ */
/* Economy path: /api/chat streams NDJSON deltas from an SSE provider  */
/* ------------------------------------------------------------------ */

test('/api/chat — economy mode streams bolt output as NDJSON deltas (MOCKED)', async () => {
  const request = new Request('http://localhost:3000/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'sec-fetch-site': 'same-origin' },
    body: JSON.stringify({
      provider: 'ollama', model: MOCK_MODEL,
      messages: [{ role: 'user', content: E2E_PROMPTS.testA }],
      files: {},
    }),
  })
  const response = await chatPOST(request)
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type') ?? '', /x-ndjson/)

  const outcome = await readStream(response)
  assert.equal(outcome.streamError, null)
  assert.ok(outcome.events.filter(event => event.type === 'delta').length >= 2, 'multiple deltas must stream')
  assert.ok(outcome.events.some(event => event.type === 'done'), 'stream must finish with done')
  assert.match(outcome.text, /boltAction/, 'chat protocol payload survives streaming')
  const files = parseAIResponseActions(outcome.text).files
  assert.ok(files.some(file => file.path === 'src/App.tsx'), 'files parse from the streamed text')
})

/* ------------------------------------------------------------------ */
/* Catalog path: keyless Ollama listing + connection test              */
/* ------------------------------------------------------------------ */

test('/api/providers — keyless Ollama catalog listing and connection test (MOCKED)', async () => {
  const listRequest = new Request('http://localhost:3000/api/providers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'sec-fetch-site': 'same-origin' },
    body: JSON.stringify({ provider: 'ollama', action: 'list' }),
  })
  const listResponse = await providersPOST(listRequest)
  assert.equal(listResponse.status, 200)
  const payload = await listResponse.json() as { models?: Array<{ id: string; tier: string }> }
  assert.ok(payload.models?.some(model => model.id === MOCK_MODEL), 'mock model is listed')
  assert.ok(payload.models!.every(model => model.tier === 'free' || model.tier === 'free-tier'), 'local runtime models classify as free')

  const testRequest = new Request('http://localhost:3000/api/providers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'sec-fetch-site': 'same-origin' },
    body: JSON.stringify({ provider: 'ollama', action: 'test', model: MOCK_MODEL }),
  })
  const testResponse = await providersPOST(testRequest)
  assert.equal(testResponse.status, 200)
  const testPayload = await testResponse.json() as { status?: string }
  assert.equal(testPayload.status, 'success', 'connection test reports success against the loopback mock')
})

/* ------------------------------------------------------------------ */
/* Security invariants hold on the E2E routes                          */
/* ------------------------------------------------------------------ */

test('cross-site orchestrate requests are rejected before any pipeline work', async () => {
  const request = new Request('http://localhost:3000/api/orchestrate', {
    method: 'POST',
    headers: { 'sec-fetch-site': 'cross-site', 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  const response = await orchestratePOST(request)
  assert.equal(response.status, 403)
})
