/**
 * Pass 13 Phase 8: evaluation harness benchmark regression tests.
 *
 * Proves the 15 benchmark tasks are executable and that scoring is NOT keyword
 * bingo: broken structure fails, keyword-stuffed but structurally broken output
 * cannot pass, and honest reference outputs score high.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { BENCHMARK_TASKS, evaluateBenchmarkTask } from '../src/lib/foundations/evaluation-harness'

test('all 15 benchmark tasks exist with executable acceptance checks', () => {
  assert.equal(BENCHMARK_TASKS.length, 15)
  for (const task of BENCHMARK_TASKS) {
    assert.ok(task.id.startsWith('bench-'))
    assert.ok(task.inputPrompt.length > 40, `${task.id} prompt must be a fixed real instruction`)
    assert.ok(task.acceptanceChecks.length >= 2, `${task.id} needs executable acceptance checks`)
    assert.ok(Object.keys(task.fixture).length >= 4, `${task.id} needs a fixed fixture`)
    for (const check of task.acceptanceChecks) {
      assert.equal(typeof check.test({}), 'boolean', `${task.id} check "${check.description}" must be executable without throwing`)
    }
  }
})

test('a well-formed landing page output passes bench-01', () => {
  const task = BENCHMARK_TASKS[0]
  const output = {
    'package.json': task.fixture['package.json'],
    'index.html': task.fixture['index.html'],
    'src/main.tsx': task.fixture['src/main.tsx'],
    'src/index.css': 'body { margin: 0 }',
    'src/App.tsx': `
export default function App() {
  const features = [{ title: 'Fast' }, { title: 'Safe' }, { title: 'Simple' }]
  return (
    <>
      <nav><a href="#home">Home</a></nav>
      <header><h1>Acme</h1><button onClick={() => {}}>Get started now</button></header>
      <section>{features.map(f => <div key={f.title}><h3>{f.title}</h3></div>)}</section>
      <footer><a href="mailto:hi@acme.dev">Contact us</a></footer>
    </>
  )
}`,
  }
  const result = evaluateBenchmarkTask(task, 'reference-model', output)
  assert.equal(result.passed, true, `diagnostics: ${result.diagnostics.join(' | ')}`)
  assert.equal(result.score >= 70, true)
  assert.equal(result.buildResult, 'not_run')
  assert.equal(result.executedLive, false)
})

test('keyword-stuffed but broken output cannot pass (no keyword bingo)', () => {
  const task = BENCHMARK_TASKS[0]
  const stuffed = {
    'src/App.tsx': 'nav header footer hero get started button features map( — but the code is broken: export default function App( { return <div>',
  }
  const result = evaluateBenchmarkTask(task, 'stuffed-model', stuffed)
  assert.equal(result.passed, false, 'unbalanced braces and missing required files must fail')
  assert.ok(result.score < 70, `score ${result.score} must be below the pass line`)
})

test('forbidden security patterns cap the score regardless of other quality', () => {
  const task = BENCHMARK_TASKS.find(entry => entry.id === 'bench-06-auth')!
  const output = {
    'src/App.tsx': `
export default function App() {
  const password = "super-secret-123"
  const [email, setEmail] = useState('')
  const ok = localStorage.getItem('session')
  return ok ? (isAuthenticated ? <Dashboard user={user} /> : null) : <form><input type="email" /><input type="password" /></form>
}`,
  }
  const result = evaluateBenchmarkTask(task, 'leaky-model', output)
  assert.equal(result.passed, false, 'hardcoded credentials must cap the score')
  assert.ok(result.score <= 40, `capped score ${result.score} must be <= 40`)
  assert.ok(result.diagnostics.some(d => d.includes('hardcoded credentials')))
})

test('unresolved local imports reduce the structural score', () => {
  const task = BENCHMARK_TASKS.find(entry => entry.id === 'bench-14-multi-file')!
  const output = {
    'src/utils/format.ts': 'export function formatCurrency(amount: number, currency?: string) { return amount.toFixed(2) }',
    'src/utils/index.ts': "export * from './format'",
    'src/App.tsx': "import { formatCurrency } from './utils/missing-file'\nexport default function App() { return <div>{formatCurrency(2)}</div> }",
  }
  const result = evaluateBenchmarkTask(task, 'importer-model', output)
  assert.ok(result.diagnostics.some(d => d.includes('unresolved local import')), 'unresolved import must be reported')
  assert.ok(result.breakdown.structure < 100, 'structural score must drop below 100')
  assert.ok(result.score < 100, 'total score must be penalised')
})

test('scores are deterministic for identical outputs', () => {
  const task = BENCHMARK_TASKS[2]
  const output = { 'src/App.tsx': 'export default function App() { return <table><tbody><tr><td>x</td></tr></tbody></table> }' }
  const a = evaluateBenchmarkTask(task, 'm', output)
  const b = evaluateBenchmarkTask(task, 'm', output)
  assert.deepEqual(a.breakdown, b.breakdown)
  assert.equal(a.score, b.score)
})
