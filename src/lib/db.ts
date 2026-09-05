import { PrismaClient } from '@prisma/client'
import { createHash } from 'node:crypto'

/**
 * Canonical production database client.
 * Schema reconciliation belongs to the controlled release/build path, not to
 * request-time serverless initialization.
 */
const globalForPrisma = globalThis as unknown as { prisma?: ReturnType<PrismaClient['$extends']> }

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
const basePrisma = globalForPrisma.prisma ?? new PrismaClient({
  ...(databaseUrl ? { datasources: { db: { url: databaseUrl } } } : {}),
})

function responseIdentity(content: string): { finalResponseHash: string; finalizationId: string } {
  const hash = createHash('sha256').update(content.trim(), 'utf8').digest('hex')
  return { finalResponseHash: hash, finalizationId: `ceo-final-${hash.slice(0, 16)}` }
}

/**
 * The message row remains backward-compatible. Every assistant-message create
 * or update also writes an immutable lineage record to AuditLog, keyed by the
 * persisted Message id. This gives the database an independent response
 * identity without changing the existing Message attachment contract.
 */
export const db = basePrisma.$extends({
  name: 'ceo-response-lineage',
  query: {
    message: {
      async create({ args, query }) {
        const result = await query(args)
        if (String(args.data.role).toLowerCase() === 'assistant') {
          const identity = responseIdentity(String(args.data.content ?? ''))
          await basePrisma.auditLog.create({
            data: {
              action: 'ceo_response_finalized',
              entity: 'Message',
              entityId: result.id,
              description: 'Persisted canonical CEO response identity.',
              metadata: JSON.stringify({ ...identity, messageId: result.id, contentLength: String(args.data.content ?? '').length }),
            },
          })
        }
        return result
      },
      async update({ args, query }) {
        const result = await query(args)
        const content = (args.data as { content?: unknown }).content
        if (content !== undefined) {
          const identity = responseIdentity(String(content ?? ''))
          await basePrisma.auditLog.create({
            data: {
              action: 'ceo_response_finalized',
              entity: 'Message',
              entityId: result.id,
              description: 'Persisted updated canonical CEO response identity.',
              metadata: JSON.stringify({ ...identity, messageId: result.id, contentLength: String(content ?? '').length }),
            },
          })
        }
        return result
      },
    },
  },
})

globalForPrisma.prisma = db

export async function ensureDbReady(): Promise<void> { return }
