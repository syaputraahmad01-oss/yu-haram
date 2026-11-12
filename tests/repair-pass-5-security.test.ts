import test from 'node:test'
import assert from 'node:assert/strict'
import { readLimitedJson, validateWorkspaceFileMap } from '../src/lib/deploy/validate'
import { SandboxSecurityLayer } from '../src/lib/foundations/sandbox-security'
import { safePath, isPathSafe } from '../src/lib/utils/file-helpers'
import { buildProjectContext, isSensitiveFile } from '../src/lib/ai/orchestration'

test('Pass 5: streamed JSON body is rejected at the byte limit without Content-Length', async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"data":"12345'))
      controller.enqueue(new TextEncoder().encode('67890"}'))
      controller.close()
    },
  })
  const request = new Request('https://yuha.invalid/api/test', { method: 'POST', body, duplex: 'half' } as RequestInit)
  const result = await readLimitedJson(request, 12)
  assert.deepEqual(result, { ok: false, status: 413, error: 'Request body exceeds the 12-byte limit.' })
})

test('Pass 5: streamed JSON body parses valid UTF-8 within limit', async () => {
  const request = new Request('https://yuha.invalid/api/test', {
    method: 'POST', body: JSON.stringify({ message: 'halo' }),
  })
  const result = await readLimitedJson(request, 128)
  assert.equal(result.ok, true)
  if (result.ok) assert.deepEqual(result.value, { message: 'halo' })
})

test('Pass 5: sandbox path validator rejects absolute, traversal and dot-only segments', () => {
  for (const path of ['/etc/passwd', '\\\\server\\share', 'C:\\secret', '../x', 'a/../../x', '....//x', 'a//b', './x']) {
    assert.equal(SandboxSecurityLayer.validatePath(path).allowed, false, path)
    assert.equal(isPathSafe(path), false, path)
    assert.equal(safePath(path), '', path)
  }
  assert.deepEqual(SandboxSecurityLayer.validatePath('src/components/App.tsx'), {
    allowed: true, sanitizedValue: 'src/components/App.tsx',
  })
})

test('Pass 5: context pack excludes credential stores and key material', () => {
  for (const path of ['.env', '.npmrc', '.pypirc', '.netrc', '.aws/config', '.ssh/id_ed25519', '.kube/config', '.azure/credentials', '.docker/config.json', 'config/credentials.json', 'certs/client.p12', 'keys/signing.jks']) {
    assert.equal(isSensitiveFile(path), true, path)
  }
  const result = buildProjectContext({
    'src/index.ts': 'export const ok = true',
    '.npmrc': '//registry.npmjs.org/:_authToken=secret-token',
    'config/credentials.json': '{"private_key":"secret"}',
    'certs/client.p12': 'binary-secret',
  })
  assert.deepEqual(result.includedFiles, ['src/index.ts'])
  assert.ok(!result.context.includes('secret-token'))
  assert.ok(!result.context.includes('binary-secret'))
})

test('Pass 6: API workspace validation rejects traversal and malformed file maps', () => {
  assert.deepEqual(validateWorkspaceFileMap({ 'src/App.tsx': 'export {}' }), { valid: true })
  assert.equal(validateWorkspaceFileMap({ '../secret.txt': 'no' }).valid, false)
  assert.equal(validateWorkspaceFileMap({ 'src/App.tsx': 42 }).valid, false)
  assert.equal(validateWorkspaceFileMap([]).valid, false)
  assert.equal(validateWorkspaceFileMap(Object.fromEntries(Array.from({ length: 501 }, (_, i) => [`f${i}.txt`, 'x']))).valid, false)
})

test('Pass 6: context pack rejects unsafe paths and redacts provider-specific tokens', () => {
  for (const path of ['../outside.ts', 'src/../../outside.ts', 'src\\..\\outside.ts', 'bad\nname.ts', '.envrc', '.git-credentials', '.terraform/terraform.tfstate', '.vercel/project.json']) {
    assert.equal(isSensitiveFile(path), true, path)
  }
  const secrets = [
    'sk-or-v1-' + 'a'.repeat(40),
    'sk-proj-' + 'b'.repeat(40),
    'xoxb-' + 'c'.repeat(24),
    'npm_' + 'd'.repeat(36),
    'ya29.' + 'e'.repeat(30),
  ]
  const result = buildProjectContext({ 'src/config.ts': secrets.join('\n') })
  for (const secret of secrets) assert.equal(result.context.includes(secret), false)
  assert.ok(result.context.includes('[REDACTED_SECRET]'))
})

test('Pass 5: network egress blocks private, loopback, metadata and non-HTTP targets', () => {
  for (const url of [
    'http://127.0.0.1', 'http://10.0.0.2', 'http://172.16.0.1', 'http://192.168.1.1',
    'http://169.254.169.254', 'http://localhost', 'http://[::1]', 'http://[fd00::1]', 'http://[::ffff:127.0.0.1]',
    'ftp://example.com', 'http://user:password@example.com',
  ]) {
    assert.equal(SandboxSecurityLayer.validateNetworkEgress(url).allowed, false, url)
  }
  assert.equal(SandboxSecurityLayer.validateNetworkEgress('https://example.com').allowed, true)
})

test('Pass 5: JSON reader rejects invalid UTF-8 and invalid configured limits', async () => {
  const invalidUtf8 = new Request('https://yuha.invalid/api/test', {
    method: 'POST', body: new Uint8Array([0xff, 0xfe]),
  })
  const malformed = await readLimitedJson(invalidUtf8, 16)
  assert.equal(malformed.ok, false)
  if (malformed.ok === false) assert.match(malformed.error, /UTF-8/)

  const invalidLimit = await readLimitedJson(new Request('https://yuha.invalid/api/test', {
    method: 'POST', body: '{}',
  }), 0)
  assert.equal(invalidLimit.ok, false)
  if (invalidLimit.ok === false) assert.equal(invalidLimit.status, 400)
})
