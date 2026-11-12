import { PrismaClient } from '@prisma/client'

/**
 * YUHA database client — Supabase PostgreSQL via Prisma (Phase 4).
 *
 * Connection topology (see .env.example):
 *  - DATABASE_URL → Supabase Transaction Pooler (pgbouncer, port 6543) for
 *    all runtime queries. Supabase caps pooler connections per project, so
 *    exactly ONE PrismaClient per process is mandatory — never construct
 *    another instance.
 *  - DIRECT_URL → Session Pooler (port 5432); used only by the Prisma CLI
 *    (migrate / db push) — the app server never connects through it.
 *
 * Singleton rules:
 *  - The instance is cached on globalThis so Next.js dev hot reloads and the
 *    Bun runtime reuse ONE client instead of stacking connections
 *    (connection exhaustion / leak prevention).
 *  - Multi-instance deployments are safe: each process holds one pooled
 *    connection set against the shared pooler.
 *
 * Logging: query logging is opt-in via YUHA_DB_LOG_QUERIES=1 (debugging).
 * Default logs errors only — 'query' logging in production is both a
 * performance drag and a data-leak surface.
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

const logConfig = process.env.YUHA_DB_LOG_QUERIES === '1'
  ? (['query', 'error', 'warn'] as const)
  : (['error'] as const)

export const db: PrismaClient = globalForPrisma.prisma ?? new PrismaClient({ log: [...logConfig] })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
