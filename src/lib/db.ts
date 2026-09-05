import { PrismaClient } from '@prisma/client'

/**
 * Canonical production database client.
 * Schema reconciliation belongs to the controlled release/build path, not to
 * request-time serverless initialization.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

function buildRuntimeDatabaseUrl(): string | undefined {
  const raw = process.env.DATABASE_URL?.trim()
  if (!raw) return undefined
  try {
    const url = new URL(raw)
    if (!url.searchParams.has('connection_limit')) url.searchParams.set('connection_limit', '1')
    if (!url.searchParams.has('pool_timeout')) url.searchParams.set('pool_timeout', '20')
    return url.toString()
  } catch { return raw }
}

const databaseUrl = buildRuntimeDatabaseUrl()

export const db = globalForPrisma.prisma ?? new PrismaClient({
  ...(databaseUrl ? { datasources: { db: { url: databaseUrl } } } : {}),
})

globalForPrisma.prisma = db

export async function ensureDbReady(): Promise<void> { return }
