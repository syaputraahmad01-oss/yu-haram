import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

async function packageScripts(): Promise<Record<string, string>> {
  const manifest: { scripts: Record<string, string> } = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  )
  return manifest.scripts
}

test('postinstall generates the Prisma client without running database migrations', async () => {
  const scripts = await packageScripts()
  assert.equal(scripts.postinstall, 'prisma generate')
})

test('production start uses Node for the standalone server and preserves logging', async () => {
  const scripts = await packageScripts()
  assert.equal(scripts.start, 'NODE_ENV=production node .next/standalone/server.js 2>&1 | tee server.log')
})
