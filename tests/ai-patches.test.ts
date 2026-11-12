import test from 'node:test'
import assert from 'node:assert/strict'
import { AIResponseStreamParser, parseAIResponse, resolveAIResponseActions, resolveAIResponseWithFallback } from '../src/lib/ai/parser'
import { applyWorkspaceResponse } from '../src/lib/workspace/actions'
import { useFileStore } from '../src/lib/store/useFileStore'
import { SYSTEM_PROMPT } from '../src/lib/ai/prompts'

function patch(path: string, old: string, replacement: string): string {
  return `<boltAction type="patch" filePath="${path}">${JSON.stringify({ old, new: replacement })}</boltAction>`
}

const source = { 'src/App.tsx': 'const label = "Before";\nexport default label;\n' }

test('a unique patch resolves complete file content without mutating the source', () => {
  const result = resolveAIResponseActions(patch('src/App.tsx', '"Before"', '"After"'), source)
  assert.deepEqual(result.patchFailures, [])
  assert.equal(result.files[0]?.content, 'const label = "After";\nexport default label;\n')
  assert.equal(source['src/App.tsx'], 'const label = "Before";\nexport default label;\n')
})

test('patches support exact whitespace, raw entities, deletion, and literal dollar signs', () => {
  const result = resolveAIResponseActions(patch('a.ts', '  A &amp; B\n', '$&'), { 'a.ts': '  A &amp; B\nrest' })
  assert.equal(result.files[0]?.content, '$&rest')
  assert.equal(resolveAIResponseActions(patch('a.ts', 'rest', ''), { 'a.ts': 'rest' }).files[0]?.content, '')
})

test('patches resolve sequentially after complete file actions', () => {
  const raw = '<boltAction type="file" filePath="a.ts">first</boltAction>' + patch('a.ts', 'first', 'second') + patch('a.ts', 'second', 'third')
  assert.equal(resolveAIResponseActions(raw, {}).files[0]?.content, 'third')
})

test('a missing match, repeated match, or overlapping match never yields a changed file', () => {
  for (const [text, old] of [['abc', 'missing'], ['abc abc', 'abc'], ['aaa', 'aa']]) {
    const result = resolveAIResponseActions(patch('a.ts', old, 'new'), { 'a.ts': text })
    assert.deepEqual(result.files, [])
    assert.equal(result.patchFailures.length, 1)
  }
})

test('missing source, empty old, malformed JSON, and truncated actions fail closed', () => {
  const inputs = [patch('missing.ts', 'old', 'new'), patch('a.ts', '', 'new'), '<boltAction type="patch" filePath="a.ts">invalid</boltAction>', '<boltAction type="patch" filePath="a.ts">{"old":"abc","new":"new"}']
  for (const raw of inputs) {
    const result = resolveAIResponseActions(raw, { 'a.ts': 'abc' })
    assert.deepEqual(result.files, [])
    assert.equal(result.patchFailures.length, 1)
  }
})

test('a later failure rolls back earlier patches to the same file', () => {
  const result = resolveAIResponseActions(patch('a.ts', 'old', 'new') + patch('a.ts', 'missing', 'bad'), { 'a.ts': 'old' })
  assert.deepEqual(result.files, [])
  assert.equal(result.patchFailures.length, 1)
})

test('unsafe paths never enter full-file recovery', async () => {
  for (const path of ['../secret.ts', '/secret.ts', 'C:\\secret.ts', 'src/../../secret.ts', 'src\\..\\secret.ts']) {
    let requests = 0
    await assert.rejects(resolveAIResponseWithFallback(patch(path, 'old', 'new'), {}, async () => { requests++; return '' }), /path tidak aman/)
    assert.equal(requests, 0)
  }
})

test('patch JSON never becomes a file through complete or incremental parsing', () => {
  const raw = patch('a.ts', 'old', 'new')
  assert.deepEqual(parseAIResponse(raw), [])
  assert.deepEqual(parseAIResponse(raw, { includeIncomplete: true }), [])
  const stream = new AIResponseStreamParser()
  for (const character of raw) assert.deepEqual(stream.push(character), [])
  assert.deepEqual(stream.getFiles(), [])
})

test('patch bodies cannot inject nested FILE or XML file actions into the file parser', () => {
  const raw = patch('a.ts', 'old', '<file path="evil.ts">evil</file>')
  assert.deepEqual(parseAIResponse(raw), [])
  const stream = new AIResponseStreamParser()
  for (const character of raw) stream.push(character)
  assert.deepEqual(stream.getFiles(), [])
})

test('a failed patch requests one complete file and ignores unrelated fallback actions', async () => {
  let requests = 0
  const result = await resolveAIResponseWithFallback(patch('src/App.tsx', 'missing', 'new'), source, async instruction => {
    requests++
    assert.match(instruction, /complete file actions only/)
    assert.match(instruction, /src\/App.tsx/)
    return '<boltAction type="file" filePath="src/App.tsx">recovered</boltAction><boltAction type="file" filePath="extra.ts">ignored</boltAction><boltAction type="shell">npm run build</boltAction>'
  })
  assert.equal(requests, 1)
  assert.deepEqual(result.files.map(file => [file.path, file.content]), [['src/App.tsx', 'recovered']])
  assert.deepEqual(result.commands, [])
})

test('incomplete or repeated-patch recovery rejects without retrying indefinitely', async () => {
  for (const fallback of ['', '<boltAction type="file" filePath="src/App.tsx">truncated', patch('src/App.tsx', 'missing', 'again')]) {
    let requests = 0
    await assert.rejects(resolveAIResponseWithFallback(patch('src/App.tsx', 'missing', 'new'), source, async () => { requests++; return fallback }), /Fallback/)
    assert.equal(requests, 1)
  }
})

test('workspace applies a validated patch through the existing file store', async () => {
  const previous = useFileStore.getState()
  try {
    useFileStore.getState().setFiles({ ...source })
    await applyWorkspaceResponse(patch('src/App.tsx', 'Before', 'After'), source, async () => { throw new Error('Fallback must not run') })
    assert.equal(useFileStore.getState().files['src/App.tsx'], source['src/App.tsx'].replace('Before', 'After'))
  } finally { useFileStore.setState(previous) }
})

test('failed recovery leaves all workspace files unchanged, including earlier valid patches', async () => {
  const previous = useFileStore.getState()
  const files = { 'a.ts': 'one', 'b.ts': 'two' }
  try {
    useFileStore.getState().setFiles({ ...files })
    await assert.rejects(applyWorkspaceResponse(patch('a.ts', 'one', 'changed') + patch('b.ts', 'missing', 'bad'), files, async () => ''), /Fallback/)
    assert.deepEqual(useFileStore.getState().files, files)
  } finally { useFileStore.setState(previous) }
})

test('failed patch recovery rolls back a complete file already shown by streaming', async () => {
  const previous = useFileStore.getState()
  try {
    useFileStore.getState().setFiles({ 'a.ts': 'streamed full file' })
    const raw = '<boltAction type="file" filePath="a.ts">streamed full file</boltAction>' + patch('a.ts', 'missing', 'bad')
    await assert.rejects(applyWorkspaceResponse(raw, { 'a.ts': 'original' }, async () => ''), /Fallback/)
    assert.equal(useFileStore.getState().files['a.ts'], 'original')
  } finally { useFileStore.setState(previous) }
})

test('workspace preserves edits made while full-file recovery is in flight', async () => {
  const previous = useFileStore.getState()
  try {
    useFileStore.getState().setFiles({ ...source })
    await assert.rejects(applyWorkspaceResponse(patch('src/App.tsx', 'missing', 'new'), source, async () => {
      useFileStore.getState().setFile('src/App.tsx', 'user edit')
      return '<boltAction type="file" filePath="src/App.tsx">recovered</boltAction>'
    }), /berubah selama generasi/)
    assert.equal(useFileStore.getState().files['src/App.tsx'], 'user edit')
  } finally { useFileStore.setState(previous) }
})

test('the system prompt documents exact-match patches and full-file recovery', () => {
  for (const text of ['type="patch"', 'strict JSON', 'match exactly once', 'new files, large changes, or patch recovery', 'never another patch or shell action']) {
    assert.ok(SYSTEM_PROMPT.includes(text), text)
  }
})
