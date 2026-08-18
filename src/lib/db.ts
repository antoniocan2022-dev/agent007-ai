import { PrismaClient } from '@prisma/client'

/**
 * Canonical production database client.
 *
 * Schema reconciliation belongs to the controlled release/build path, not to
 * request-time serverless initialization. Runtime DDL caused connection-pool
 * exhaustion because every cold function attempted dozens of CREATE TABLE
 * statements before serving a request.
 *
 * Owner/bootstrap data is provisioned explicitly by scripts/bootstrap-owner-data.ts.
 */
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient
}

function buildRuntimeDatabaseUrl(): string | undefined {
  const raw = process.env.DATABASE_URL?.trim()
  if (!raw) return undefined

  try {
    const url = new URL(raw)
    // Prisma ORM 6 serverless clients use connection_limit/pool_timeout URL
    // parameters. Keep an explicitly configured value untouched; otherwise
    // start conservatively with one connection per function instance.
    if (!url.searchParams.has('connection_limit')) {
      url.searchParams.set('connection_limit', '1')
    }
    if (!url.searchParams.has('pool_timeout')) {
      url.searchParams.set('pool_timeout', '20')
    }
    return url.toString()
  } catch {
    // Let Prisma produce its normal, actionable URL validation error.
    return raw
  }
}

const databaseUrl = buildRuntimeDatabaseUrl()

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    ...(databaseUrl
      ? {
          datasources: {
            db: { url: databaseUrl },
          },
        }
      : {}),
  })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db
}

/**
 * Kept for compatibility with existing callers. Database readiness is now a
 * release concern; Prisma connects lazily on the first real query.
 */
export async function ensureDbReady(): Promise<void> {
  return
}
