import { db } from '@/lib/db'
import { rejectCrossOrigin } from '@/lib/deploy/validate'
import { checkRateLimit, rateLimitedResponse, RATE_LIMITS } from '@/lib/security/rate-limit'

/**
 * Database health — GET /api/health/database
 *
 * Verifies the Supabase PostgreSQL connection end-to-end from the running
 * app (through the transaction pooler). Response never contains connection
 * strings, hostnames, credentials, or raw driver errors — only status and
 * round-trip latency. Raw Prisma errors can embed host/user details, so they
 * are logged server-side and reduced to a generic class here.
 */

export const runtime = 'nodejs'
export const maxDuration = 15

const headers = { 'Cache-Control': 'no-store' }

function databaseConfigured(): boolean {
  const url = process.env.DATABASE_URL
  return !!url && !url.includes('<PASSWORD>') && (url.startsWith('postgresql://') || url.startsWith('postgres://'))
}

export async function GET(request: Request) {
  if (rejectCrossOrigin(request)) return Response.json({ error: 'Cross-site requests are not allowed.' }, { status: 403, headers })
  const rate = await checkRateLimit(request, RATE_LIMITS.health)
  if (!rate.ok) return rateLimitedResponse(rate)

  if (!databaseConfigured()) {
    return Response.json(
      { status: 'unconfigured', database: 'postgresql', detail: 'DATABASE_URL is not set. Configure the Supabase connection (see .env.example).' },
      { status: 503, headers },
    )
  }

  const startedAt = Date.now()
  try {
    await db.$queryRaw`SELECT 1`
    return Response.json({ status: 'ok', database: 'postgresql', latencyMs: Date.now() - startedAt }, { headers })
  } catch (error) {
    // Server-side log keeps the detail; the client gets a class, not a leak.
    console.error('[api/health/database] connection failed:', error)
    return Response.json(
      { status: 'unreachable', database: 'postgresql', hint: 'Check that the Supabase password is set and the project is reachable.' },
      { status: 503, headers },
    )
  }
}
