import { PrismaClient } from '@prisma/client'

/**
 * Prisma client singleton.
 *
 * In dev mode we cache the client on globalThis to avoid exhausting DB
 * connections during HMR. If the schema has changed (e.g. a new model was
 * added via `prisma db push`), we detect the mismatch and re-instantiate
 * the client so the new model is available without a full server restart.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  prismaSchemaVersion?: string
}

// Bump this whenever you push a schema change that adds/removes models.
// On the next request, the client will be re-created with the new schema.
const SCHEMA_VERSION = 'v3-pending-manage-action-1'

function createPrisma(): PrismaClient {
  return new PrismaClient({ log: ['query'] })
}

let db: PrismaClient
if (globalForPrisma.prisma && globalForPrisma.prismaSchemaVersion === SCHEMA_VERSION) {
  db = globalForPrisma.prisma
} else {
  // Either no cached client, or the schema version changed — create a new one.
  try {
    globalForPrisma.prisma?.$disconnect?.()
  } catch {
    /* ignore */
  }
  db = createPrisma()
  globalForPrisma.prisma = db
  globalForPrisma.prismaSchemaVersion = SCHEMA_VERSION
}

export { db }