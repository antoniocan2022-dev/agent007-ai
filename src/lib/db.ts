import { PrismaClient } from '@prisma/client'
import { createHash } from 'node:crypto'

/** Canonical production database client. */
const globalForPrisma = globalThis as unknown as { prismaBase?: PrismaClient; prisma?: PrismaClient }

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
const basePrisma = globalForPrisma.prismaBase ?? new PrismaClient({ ...(databaseUrl ? { datasources: { db: { url: databaseUrl } } } : {}) })
globalForPrisma.prismaBase = basePrisma

function responseIdentity(content: string): { finalResponseHash: string; finalizationId: string } {
  const hash = createHash('sha256').update(content.trim(), 'utf8').digest('hex')
  return { finalResponseHash: hash, finalizationId: `ceo-final-${hash.slice(0, 16)}` }
}

async function recordAssistantIdentity(messageId: string, content: string, description: string): Promise<void> {
  const identity = responseIdentity(content)
  await basePrisma.auditLog.create({ data: { action: 'ceo_response_finalized', entity: 'Message', entityId: messageId, description, metadata: JSON.stringify({ ...identity, messageId, contentLength: content.length }) } })
}

const extendedPrisma = basePrisma.$extends({
  name: 'ceo-response-lineage',
  query: {
    message: {
      async create({ args, query }) {
        const result = await query(args)
        if (String(args.data.role).toLowerCase() === 'assistant') await recordAssistantIdentity(result.id, String(args.data.content ?? ''), 'Persisted canonical CEO response identity.')
        return result
      },
      async update({ args, query }) {
        const result = await query(args)
        const content = (args.data as { content?: unknown }).content
        if (content !== undefined) {
          const existing = await basePrisma.message.findUnique({ where: args.where, select: { role: true } })
          if (existing?.role?.toLowerCase() === 'assistant') await recordAssistantIdentity(result.id, String(content ?? ''), 'Persisted updated canonical CEO response identity.')
        }
        return result
      },
    },
  },
})

/** Runtime extension preserves the Prisma surface type for existing consumers. */
export const db: PrismaClient = (globalForPrisma.prisma ?? extendedPrisma) as unknown as PrismaClient
globalForPrisma.prisma = db

export async function ensureDbReady(): Promise<void> { return }
