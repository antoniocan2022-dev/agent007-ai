/**
 * CHARTER INJECTOR — seeds the Agent007 Operational Charter into the KB
 * on every cold start. This ensures the charter is always available even
 * if the DB is reset (Vercel ephemeral filesystem).
 *
 * Called from: src/lib/db.ts seedData() on every cold start.
 * Idempotent: if the charter already exists, it's a no-op.
 */
import { db } from './db'
import { indexDocument } from './knowledge-base'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

const CHARTER_FILENAME = 'agent007-operational-charter.md'
const CHARTER_PATH = join(process.cwd(), 'public', 'agent007-charter.md')

export async function injectCharterIntoKB(userId: string): Promise<void> {
  try {
    // Check if charter already exists for this user
    const existing = await db.knowledgeDoc.findFirst({
      where: { userId, filename: CHARTER_FILENAME },
    })
    if (existing) {
      // Already injected — skip
      return
    }

    // Read the charter file
    if (!existsSync(CHARTER_PATH)) {
      console.warn('[charter-injector] Charter file not found at', CHARTER_PATH)
      return
    }
    const text = readFileSync(CHARTER_PATH, 'utf-8')

    // Create the doc record
    const doc = await db.knowledgeDoc.create({
      data: {
        userId,
        filename: CHARTER_FILENAME,
        mimeType: 'text/markdown',
        size: Buffer.byteLength(text),
        text,
        chunkCount: 0,
      },
    })

    // Index the chunks
    const chunkCount = await indexDocument(userId, doc.id, text)

    console.log(`[charter-injector] Injected charter into KB: ${chunkCount} chunks, ${text.length} chars`)
  } catch (e: any) {
    console.error('[charter-injector] Failed:', e?.message)
    // Don't throw — charter injection is best-effort, shouldn't block cold start
  }
}
