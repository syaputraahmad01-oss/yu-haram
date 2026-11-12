/**
 * Phase 10 — reproducible latency benchmark against live Supabase PostgreSQL
 * through the RUNTIME path (DATABASE_URL / transaction pooler, pgbouncer).
 *
 * Measures: 10 sequential `SELECT 1` round-trips from a single Prisma client
 * (steady-state pool behavior) + cold-start cost of the first query.
 * Prints min/p50/avg/max. No latency claims beyond what is printed here.
 *
 * Run: set -a; source .env; set +a; bun scripts/benchmark-supabase-latency.ts
 */
import { PrismaClient } from '@prisma/client'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value || value.includes('<PASSWORD>')) {
    console.error(`REFUSING to run: ${name} is not configured.`)
    process.exit(1)
  }
  if (!value.startsWith('postgresql://') && !value.startsWith('postgres://')) {
    console.error(`REFUSING to run: ${name} is not a PostgreSQL URL — source the project .env first.`)
    process.exit(1)
  }
  return value
}

const url = new URL(requireEnv('DATABASE_URL'))
requireEnv('DIRECT_URL')

const prisma = new PrismaClient({ log: ['error'] })

function stats(samples: number[]): { min: number; p50: number; avg: number; max: number } {
  const sorted = [...samples].sort((a, b) => a - b)
  const avg = Math.round(samples.reduce((a, b) => a + b, 0) / samples.length)
  return { min: sorted[0], p50: sorted[Math.floor(sorted.length / 2)], avg, max: sorted[sorted.length - 1] }
}

async function main() {
  console.log(`\n=== SUPABASE LATENCY BENCHMARK (runtime: transaction pooler ${url.hostname}:${url.port}) ===\n`)

  const t0 = Date.now()
  await prisma.$queryRaw`SELECT 1`
  const cold = Date.now() - t0
  console.log(`cold first query (client init + connect + SELECT 1): ${cold} ms`)

  const samples: number[] = []
  for (let i = 1; i <= 10; i++) {
    const t = Date.now()
    await prisma.$queryRaw`SELECT 1`
    const dt = Date.now() - t
    samples.push(dt)
    console.log(`warm query ${String(i).padStart(2)}/${10}: ${String(dt).padStart(4)} ms`)
  }

  const s = stats(samples)
  console.log(`\nsteady state over 10 queries: min=${s.min}ms p50=${s.p50}ms avg=${s.avg}ms max=${s.max}ms`)
  console.log('(measured from this sandbox to Supabase AP-NORTHEAST-2; single client, sequential)')
}

main().finally(() => prisma.$disconnect().catch(() => {}))
