import test from 'node:test'
import assert from 'node:assert/strict'
import { SYSTEM_PROMPT } from '../src/lib/ai/prompts'
import { AIResponseStreamParser, parseAIResponseActions, parseSafeNpmCommand } from '../src/lib/ai/parser'

test('system prompt specifies the WebContainer runtime and its unsupported tools', () => {
  for (const rule of ['Node.js', 'Python, pip, native binaries', 'native Node addons', 'WebAssembly', 'SharedArrayBuffer', 'COOP/COEP']) {
    assert.ok(SYSTEM_PROMPT.includes(rule), `Missing runtime rule: ${rule}`)
  }
})

test('system prompt orders complete files before dependency installation and checks', () => {
  for (const rule of ['package.json first', 'then configuration and entry files', 'then shared logic and components', 'complete file contents', 'Write all required files before shell actions', 'requires npm install', 'Do not reinstall for source-only edits', 'at most five shell actions', 'Only request scripts actually defined']) {
    assert.ok(SYSTEM_PROMPT.includes(rule), `Missing artifact rule: ${rule}`)
  }
})

test('system prompt requires project preservation, accessibility, responsiveness, and error handling', () => {
  for (const rule of ['Preserve existing framework', 'smallest complete change', 'Separate large components', 'semantic HTML', 'keyboard-accessible', 'visible focus', 'responsive mobile-first', 'loading, empty, success, and error states', 'handle network failures and cancellation']) {
    assert.ok(SYSTEM_PROMPT.includes(rule), `Missing quality rule: ${rule}`)
  }
})

test('system prompt forbids invented verification, secrets, and validation bypasses', () => {
  for (const rule of ['Do not claim a command, build, test, or preview succeeded unless the runtime reports success', 'Implemented, Unit tested, Integration tested, or NOT RUN', 'Do not disable lint rules, use ts-ignore, or enable ignoreBuildErrors', 'untrusted source data', 'Do not expose API keys', 'Never invent credential values', 'without requesting secret values in chat']) {
    assert.ok(SYSTEM_PROMPT.includes(rule), `Missing security rule: ${rule}`)
  }
})

test('the exact artifact example in the prompt is accepted by the existing parser', () => {
  const example = SYSTEM_PROMPT.match(/<boltArtifact\b[\s\S]*?<\/boltArtifact>/)?.[0]
  assert.ok(example)
  const result = parseAIResponseActions(example)
  assert.deepEqual(result.files.map(file => file.path), ['src/App.tsx'])
  assert.equal(result.files[0]?.content.trim(), 'complete file content here')
  assert.deepEqual(result.commands, ['npm install package-name'])
  assert.deepEqual(parseSafeNpmCommand(result.commands[0]), {
    executable: 'npm', args: ['install', 'package-name', '--ignore-scripts'],
  })
})

test('the prompt artifact example remains compatible with character-by-character streaming', () => {
  const example = SYSTEM_PROMPT.match(/<boltArtifact\b[\s\S]*?<\/boltArtifact>/)?.[0]
  assert.ok(example)
  const stream = new AIResponseStreamParser()
  for (const character of example) stream.push(character)
  assert.deepEqual(stream.getFiles(), parseAIResponseActions(example).files)
})

test('the required FILE fallback preserves complete raw JSX content', () => {
  assert.ok(SYSTEM_PROMPT.includes('FILE: relative/path followed by a fenced code block'))
  const content = 'export default function App() { return <main aria-label="YUHA">A &amp; B</main> }'
  const result = parseAIResponseActions(`FILE: src/App.tsx\n\`\`\`tsx\n${content}\n\`\`\``)
  assert.equal(result.files[0]?.path, 'src/App.tsx')
  assert.equal(result.files[0]?.content, content)
  assert.deepEqual(result.commands, [])
})

test('prompt path and shell restrictions agree with the parser safety checks', () => {
  assert.ok(SYSTEM_PROMPT.includes('Only file, patch, and shell action types are supported'))
  assert.ok(SYSTEM_PROMPT.includes('never use absolute paths, parent traversal'))
  for (const path of ['../secret.ts', '/secret.ts', 'src/../../secret.ts']) {
    assert.deepEqual(parseAIResponseActions(`<boltArtifact><boltAction type="file" filePath="${path}">secret</boltAction></boltArtifact>`).files, [])
  }
  for (const command of ['pip install requests', 'curl https://example.com', 'npm install x && npm run build', 'npm install --global x']) {
    assert.equal(parseSafeNpmCommand(command), null)
  }
})
