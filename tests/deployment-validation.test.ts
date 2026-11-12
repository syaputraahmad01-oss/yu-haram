import test from 'node:test'
import assert from 'node:assert/strict'
import { isForbiddenDeploymentPath, validateDeploymentFiles } from '../src/lib/deploy/validate'

test('deployment validation accepts ordinary files and the safe env template', () => {
  const result = validateDeploymentFiles({
    'index.html': '<!doctype html>',
    'src/main.tsx': 'export {}',
    '.env.example': 'PUBLIC_API_URL=',
  })
  assert.equal(result.valid, true)
  assert.equal(result.error, undefined)
})

test('deployment validation rejects secret files and traversal paths', () => {
  for (const path of ['.env', '.env.local', 'config/.env.production', '.npmrc', '.git/config', '.ssh/id_ed25519', '.aws/credentials', 'service-account.json', 'id_rsa', 'certs/private.pem', '../secret.txt', 'src/../../secret.txt', '/etc/passwd', 'C:\\secret.txt']) {
    assert.equal(isForbiddenDeploymentPath(path), true, `${path} must be rejected`)
    assert.equal(validateDeploymentFiles({ [path]: 'secret' }).valid, false, `${path} must fail validation`)
  }
})

test('deployment validation enforces file count and content size limits', () => {
  const tooMany = Object.fromEntries(Array.from({ length: 501 }, (_, i) => [`file-${i}.txt`, 'x']))
  assert.equal(validateDeploymentFiles(tooMany).valid, false)
  assert.equal(validateDeploymentFiles({ 'large.txt': 'x'.repeat(1_000_001) }).valid, false)
})

test('bounded JSON reader rejects oversized bodies before parsing', async () => {
  const { readLimitedJson } = await import('../src/lib/deploy/validate')
  const oversized = new Request('https://yuha.invalid/api/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ value: 'x'.repeat(100) }),
  })
  const rejected = await readLimitedJson(oversized, 32)
  assert.equal(rejected.ok, false)
  if (rejected.ok === false) assert.equal(rejected.status, 413)

  const valid = new Request('https://yuha.invalid/api/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ value: 'ok' }),
  })
  const accepted = await readLimitedJson(valid, 128)
  assert.equal(accepted.ok, true)
  if (accepted.ok) assert.deepEqual(accepted.value, { value: 'ok' })
})

test('deployment path validation rejects Windows separators and hidden credential directories', () => {
  for (const path of ['..\\secret.txt', 'folder\\..\\secret.txt', '.aws/config', 'backup/.aws/credentials', '.config/gcloud/application_default_credentials.json', 'folder/.env.backup']) {
    assert.equal(isForbiddenDeploymentPath(path), true, `${path} must be rejected`)
  }
})
