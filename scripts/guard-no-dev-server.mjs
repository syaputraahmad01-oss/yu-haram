#!/usr/bin/env node
/**
 * Pre-build guard (2026-11-12 incident).
 *
 * `next build` rewrites the .next directory. A live dev server serves from
 * .next/dev, and a build that runs under it can destroy that state — every
 * request then fails with ENOENT manifests (routes-manifest.json,
 * build-manifest.json, [turbopack]_runtime.js) and answers 500 until the
 * server is restarted. That is exactly how the user-facing preview went down.
 *
 * This guard refuses to build while a dev server is listening on :3000.
 * Stop it first, build, then restart it.
 */
const BASE = 'http://localhost:3000'

try {
  const response = await fetch(BASE, { redirect: 'manual' })
  console.error(`REFUSING to build: a dev server is live on ${BASE} (status ${response.status}).`)
  console.error('next build rewrites .next and can corrupt the running dev server (ENOENT manifests -> 500s).')
  console.error('Stop it first: pkill -f "next dev"  — restart afterwards: python3 scripts/dev-daemon.py')
  process.exit(1)
} catch {
  process.exit(0) // port free -> safe to build
}
