/**
 * LIVE E2E VERIFICATION — real dev server + real HTTP + MOCKED provider.
 *
 * Spawns `bun run dev` (Next.js 16 + Turbopack) as a child process, starts the
 * mock Ollama server on the documented loopback address, then drives the REAL
 * pipeline through actual HTTP requests:
 *
 *   1. GET /               → 200 + COOP/COEP headers (WebContainer isolation)
 *   2. POST /api/providers → keyless Ollama catalog listing (loopback SSRF path)
 *   3. POST /api/orchestrate → full Test A pipeline (plan → generate → files →
 *      verification → done) streamed as NDJSON over a real socket.
 *
 * Honest scope: the provider is MOCKED (loopback). This verifies the Next.js
 * wiring and transport, not any real model.
 */

import { spawn } from 'node:child_process'
import { mkdir, rm, readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { startMockOllama, closeMockOllama, createMockControl, MOCK_MODEL } from '../tests/helpers/mock-ollama'
import { E2E_SCENARIOS, E2E_PROMPTS } from '../tests/helpers/e2e-projects'

const BASE = 'http://localhost:3000'
const repoRoot = resolve(import.meta.dirname, '..')

function log(step: string, ok: boolean, detail = '') {
  const line = `${ok ? 'PASS' : 'FAIL'}  ${step}${detail ? '  — ' + detail : ''}`
  console.log(line)
  if (!ok) process.exitCode = 1
}

async function waitForServer(timeoutMs = 120_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(BASE, { redirect: 'manual' })
      if (response.status > 0) return true
    } catch { /* not up yet */ }
    await new Promise(resolve => setTimeout(resolve, 1500))
  }
  return false
}

async function main() {
  await mkdir(join(repoRoot, '.data'), { recursive: true }).catch(() => {})
  const control = createMockControl(E2E_SCENARIOS)
  const server = await startMockOllama(control)
  console.log('Mock Ollama listening on 127.0.0.1:11434 (loopback, MOCKED provider)')

  // The dev server writes checkpoints to <repo>/.data/checkpoints — remember
  // which files exist so the live run can clean up after itself.
  const checkpointDir = join(repoRoot, '.data', 'checkpoints')
  const before = new Set(await readdir(checkpointDir).catch(() => [] as string[]))

  // Incident 2026-11-12 ("preview down"): when this script ran while the
  // sandbox's preview dev server already owned :3000, the spawned dev crashed
  // with EADDRINUSE, waitForServer happily talked to the PREVIEW server, and
  // the final cleanup deleted .next/dev out from under it — every subsequent
  // request ENOENT'd its manifests and the preview served 500s until restart.
  // Refuse to run against a port we do not own.
  const portOwner = await fetch(BASE, { redirect: 'manual' }).then(() => true, () => false)
  if (portOwner) {
    console.error(`LIVE E2E: REFUSING to run — ${BASE} already answers, so another dev server owns :3000.`)
    console.error('Running here would test that unrelated server, and the cleanup would corrupt its .next/dev cache.')
    console.error('Stop it first (pkill -f "next dev") or free the port, then re-run. Restart it later with: python3 scripts/dev-daemon.py')
    await closeMockOllama(server)
    process.exitCode = 1
    return
  }

  const dev = spawn('bun', ['run', 'dev'], { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] })
  const devLog: string[] = []
  dev.stdout.on('data', (chunk: Buffer) => devLog.push(chunk.toString()))
  dev.stderr.on('data', (chunk: Buffer) => devLog.push(chunk.toString()))

  try {
    const up = await waitForServer()
    log('dev server ready on :3000', up, up ? '' : devLog.slice(-15).join(''))
    if (!up) return

    // 1. Security headers that WebContainer requires.
    const home = await fetch(BASE)
    const coop = home.headers.get('cross-origin-opener-policy')
    const coep = home.headers.get('cross-origin-embedder-policy')
    log('GET / serves COOP/COEP', home.status === 200 && coop === 'same-origin' && !!coep, `status=${home.status} coop=${coop} coep=${coep}`)

    // 2. Keyless catalog listing through the loopback SSRF exception.
    const catalog = await fetch(BASE + '/api/providers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'ollama', action: 'list' }),
    })
    const catalogPayload = await catalog.json() as { models?: Array<{ id: string }> }
    log('POST /api/providers lists the mock model', catalog.status === 200 && (catalogPayload.models ?? []).some(model => model.id === MOCK_MODEL), `status=${catalog.status} models=${(catalogPayload.models ?? []).map(m => m.id).join(',')}`)

    // 3. Full orchestration pipeline through a real socket.
    const response = await fetch(BASE + '/api/orchestrate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'ollama',
        model: MOCK_MODEL,
        mode: 'balanced',
        workspaceId: 'live-verify-a',
        messages: [{ role: 'user', content: E2E_PROMPTS.testA }],
        files: {},
      }),
    })
    log('POST /api/orchestrate streams NDJSON', response.status === 200 && (response.headers.get('content-type') ?? '').includes('x-ndjson'), `status=${response.status} type=${response.headers.get('content-type')}`)

    if (response.body) {
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      const events: Array<Record<string, any>> = []
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let newline = buffer.indexOf('\n')
        while (newline >= 0) {
          const line = buffer.slice(0, newline)
          buffer = buffer.slice(newline + 1)
          if (line.trim()) {
            try { events.push(JSON.parse(line)) } catch { /* partial line */ }
          }
          newline = buffer.indexOf('\n')
        }
      }
      const types = events.map(event => event.type)
      const files = events.filter(event => event.type === 'files').flatMap(event => event.files ?? []) as Array<{ path: string }>
      const verification = events.find(event => event.type === 'verification')?.report as { overallStatus?: string } | undefined
      const done = events[events.length - 1]
      log('pipeline: planning + coding stages streamed', types.includes('stage') && types.filter(t => t === 'stage').length === 2, `stages=${events.filter(e => e.type === 'stage').map(e => e.stage).join('>')}`)
      log('pipeline: agent plan delivered', types.includes('agent-plan'))
      log('pipeline: structured files event carries the workspace', files.length >= 10, `files=${files.length} (contoh: ${files.slice(0, 3).map(f => f.path).join(', ')})`)
      log('pipeline: verification gate honest (Partially Verified)', verification?.overallStatus === 'Partially Verified', `overall=${verification?.overallStatus}`)
      log('pipeline: done event without failure', done?.type === 'done' && done?.verificationFailed === false, `type=${done?.type} verificationFailed=${done?.verificationFailed}`)
    }
  } finally {
    dev.kill('SIGTERM')
    await new Promise(resolve => setTimeout(resolve, 800))
    dev.kill('SIGKILL')
    await closeMockOllama(server)

    // Remove only the checkpoints this live run created.
    try {
      const after = await readdir(checkpointDir)
      for (const name of after) {
        if (before.has(name)) continue
        const full = join(checkpointDir, name)
        const content = await readFile(full, 'utf8').catch(() => '')
        if (content.includes('live-verify-a')) await rm(full, { force: true })
      }
    } catch { /* directory may not exist */ }
    // Delete the shared dev cache ONLY when no other dev server survived.
    // .next/dev is shared by every dev server of this repo; deleting it while
    // one is live is what took the preview down with ENOENT 500s on 2026-11-12.
    await new Promise(resolve => setTimeout(resolve, 500))
    const stillServing = await fetch(BASE, { redirect: 'manual' }).then(() => true, () => false)
    if (stillServing) {
      console.log('SKIP .next/dev cleanup — a dev server is still listening on :3000; deleting the cache under it caused the 2026-11-12 preview outage')
    } else {
      await rm(join(repoRoot, '.next', 'dev'), { recursive: true, force: true }).catch(() => {})
    }
  }
  console.log(process.exitCode ? '\nLIVE E2E: FAILED' : '\nLIVE E2E: ALL CHECKS PASSED (provider MOCKED)')
}

void main()
