import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AIResponseStreamParser, parseAIResponse, parseAIResponseActions, parseSafeNpmCommand } from '../src/lib/ai/parser'

test('parses complete FILE markdown blocks and keeps last duplicate', () => {
  const files = parseAIResponse('FILE: src/App.tsx\n```tsx\nfirst\n```\nFILE: src/App.tsx\n```tsx\nsecond\n```')
  assert.equal(files.length, 1)
  assert.equal(files[0].path, 'src/App.tsx')
  assert.equal(files[0].content, 'second')
  assert.equal(files[0].language, 'tsx')
})

test('recognizes XML artifact file tags and preserves raw source without decoding body', () => {
  const files = parseAIResponse('<artifact><file path="src/App.tsx" language="tsx">\nexport default () =&gt; &lt;main&gt;YUHA&lt;/main&gt;\n</file></artifact>')
  assert.equal(files.length, 1)
  assert.equal(files[0].path, 'src/App.tsx')
  assert.equal(files[0].content, '\nexport default () =&gt; &lt;main&gt;YUHA&lt;/main&gt;\n')
})

test('recognizes named Markdown fences without a FILE header', () => {
  const files = parseAIResponse('```tsx file="src/View.tsx"\nexport default function View() {}\n```')
  assert.equal(files[0]?.path, 'src/View.tsx')
  assert.match(files[0]?.content ?? '', /function View/)
})

test('stream parser emits safe partial file updates as deltas arrive', () => {
  const updates: Array<{ path: string; content: string }> = []
  const parser = new AIResponseStreamParser()
  const response = 'Building...\nFILE: src/App.tsx\n```tsx\nexport default function App() { return <main>YUHA</main> }\n```'
  for (const character of response) updates.push(...parser.push(character))
  assert.ok(updates.some(file => file.path === 'src/App.tsx' && file.content === ''))
  assert.equal(updates.at(-1)?.path, 'src/App.tsx')
  assert.match(updates.at(-1)?.content ?? '', /YUHA/)
  assert.equal(parser.getFiles()[0]?.content, 'export default function App() { return <main>YUHA</main> }')
})

test('stream parser tolerates XML tags split across arbitrary chunks', () => {
  const parser = new AIResponseStreamParser()
  for (const part of ['<art', 'ifact><file pa', 'th="src/index.ts">', 'export const ok = true', '</file></artifact>']) parser.push(part)
  assert.equal(parser.getFiles()[0]?.path, 'src/index.ts')
  assert.equal(parser.getFiles()[0]?.content, 'export const ok = true')
})

test('incomplete files are opt-in for non-streaming parsing and unsafe paths are rejected', () => {
  const raw = 'FILE: ../secret.ts\n```ts\nsecret\n'
  assert.deepEqual(parseAIResponse(raw), [])
  assert.deepEqual(parseAIResponse(raw, { includeIncomplete: true }), [])
  assert.deepEqual(parseAIResponse('FILE: src/Live.ts\n```ts\npartial', { includeIncomplete: true }).map(file => file.path), ['src/Live.ts'])
})

test('path traversal via a whole ".." segment is rejected ("a/../b")', () => {
  // A segment that is EXACTLY '..' escapes its directory and must be refused.
  assert.deepEqual(parseAIResponse('FILE: a/../b\n```ts\nx\n```'), [])
  assert.deepEqual(parseAIResponse('FILE: src/../secret.ts\n```ts\nx\n```'), [])
})

test('legitimate double-dot filenames like "foo..bar.ts" are accepted', () => {
  // '..' inside a filename is NOT traversal — only whole '..' segments are.
  const files = parseAIResponse('FILE: foo..bar.ts\n```ts\nexport const ok = true\n```')
  assert.equal(files.length, 1)
  assert.equal(files[0].path, 'foo..bar.ts')
  assert.match(files[0].content, /ok = true/)
})


test('parses Bolt-style file and terminal actions', () => {
  const result = parseAIResponseActions('<boltArtifact><boltAction type="file" filePath="src/App.tsx">export default function App() { return null }</boltAction><boltAction type="shell">npm install lucide-react</boltAction></boltArtifact>')
  assert.equal(result.files[0]?.path, 'src/App.tsx')
  assert.match(result.files[0]?.content ?? '', /function App/)
  assert.deepEqual(result.commands, ['npm install lucide-react'])
})

test('terminal command validator blocks arbitrary shell commands and shell operators', () => {
  assert.deepEqual(parseSafeNpmCommand('npm install lucide-react'), { executable: 'npm', args: ['install', 'lucide-react', '--ignore-scripts'] })
  assert.deepEqual(parseSafeNpmCommand('npm run build'), { executable: 'npm', args: ['run', 'build'] })
  assert.equal(parseSafeNpmCommand('rm -rf .'), null)
  assert.equal(parseSafeNpmCommand('npm install x && curl example.com'), null)
  assert.equal(parseSafeNpmCommand('npm install --global x'), null)
  assert.equal(parseSafeNpmCommand('npm exec -- rm -rf .'), null)
  assert.equal(parseSafeNpmCommand('npm run unknown-script'), null)
})
