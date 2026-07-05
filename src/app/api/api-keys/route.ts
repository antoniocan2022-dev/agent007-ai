import { NextRequest, NextResponse } from 'next/server'
import { requestOwnerAuthorization, verifyOwnerAuthorization } from '@/lib/owner-auth'
import { db, ensureDbReady } from '@/lib/db'
import { getSessionUserId } from '@/lib/session-user'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// /tmp file for persisting API keys across Vercel cold starts
const API_KEYS_FILE = path.join(os.tmpdir(), 'agent007-api-keys.json')

interface StoredKey {
  id: string
  userId: string
  name: string
  service: string
  key: string
  baseUrl: string | null
  createdAt: string
}

function readStoredKeys(): StoredKey[] {
  try {
    if (!fs.existsSync(API_KEYS_FILE)) return []
    const raw = fs.readFileSync(API_KEYS_FILE, 'utf-8')
    return JSON.parse(raw) as StoredKey[]
  } catch { return [] }
}

function writeStoredKeys(keys: StoredKey[]): void {
  try {
    fs.writeFileSync(API_KEYS_FILE, JSON.stringify(keys, null, 2), 'utf-8')
  } catch {}
}

export async function GET() {
  try {
    await ensureDbReady()
    const userId = await getSessionUserId()
    if (!userId) return NextResponse.json({ keys: [] })

    // ── LAYER 1: Check DB ────────────────────────────────────────────────
    let keys: Array<{ id: string; name: string; service: string; baseUrl: string | null; createdAt: Date }> = []
    try {
      keys = await db.apiKey.findMany({
        where: { userId },
        select: { id: true, name: true, service: true, baseUrl: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      })
    } catch { keys = [] }

    // ── LAYER 2: If DB is empty, try /tmp file ───────────────────────────
    if (keys.length === 0) {
      const stored = readStoredKeys().filter(k => k.userId === userId)
      keys = stored.map(k => ({ id: k.id, name: k.name, service: k.service, baseUrl: k.baseUrl, createdAt: new Date(k.createdAt) }))
    }

    // ── LAYER 3: If still no OpenAI key, check process.env.OPENAI_API_KEY ──
    // This is the CRITICAL fix: on Vercel cold starts, both the DB and /tmp
    // are wiped. The ONLY thing that persists is the OPENAI_API_KEY env var
    // (set in Vercel → Settings → Environment Variables). We check it here
    // and return it as a "virtual" key entry so the Settings UI shows it.
    // We also auto-seed it into the DB so it persists for the current instance.
    const hasOpenAIKey = keys.some(k => k.service === 'openai')
    if (!hasOpenAIKey && process.env.OPENAI_API_KEY) {
      const envKey = process.env.OPENAI_API_KEY
      const virtualId = `env_openai_${Date.now()}`

      // Auto-seed into DB (so it shows up in future queries on this instance)
      try {
        await db.apiKey.create({
          data: {
            userId,
            name: 'OpenAI (from Vercel env var)',
            service: 'openai',
            key: envKey,
            baseUrl: null,
          },
        }).then((created: any) => {
          // Replace virtual ID with real DB ID
          keys.unshift({
            id: created.id,
            name: 'OpenAI (from Vercel env var)',
            service: 'openai',
            baseUrl: null,
            createdAt: created.createdAt,
          })
        })
      } catch {
        // If DB create fails, still show the virtual entry
        keys.unshift({
          id: virtualId,
          name: 'OpenAI (from Vercel env var)',
          service: 'openai',
          baseUrl: null,
          createdAt: new Date(),
        })
      }

      // Also write to /tmp file for this instance
      try {
        const stored = readStoredKeys()
        const alreadyInFile = stored.some(k => k.service === 'openai' && k.userId === userId)
        if (!alreadyInFile) {
          stored.push({
            id: virtualId,
            userId,
            name: 'OpenAI (from Vercel env var)',
            service: 'openai',
            key: envKey,
            baseUrl: null,
            createdAt: new Date().toISOString(),
          })
          writeStoredKeys(stored)
        }
      } catch {}

      // Clear the LLM fallback cache so it picks up the key
      try {
        const { clearKeyCache } = await import('@/lib/llm-fallback')
        clearKeyCache()
      } catch {}
    }

    // ── LAYER 4: Also check for other env var keys ──────────────────────
    // (e.g., RESEND_API_KEY, CALLMEBOT_API_KEY, etc.)
    const envKeyMap: Record<string, { envVar: string; name: string }> = {
      openai: { envVar: 'OPENAI_API_KEY', name: 'OpenAI (env var)' },
      resend: { envVar: 'RESEND_API_KEY', name: 'Resend (env var)' },
      callmebot: { envVar: 'CALLMEBOT_API_KEY', name: 'CallMeBot (env var)' },
      anthropic: { envVar: 'ANTHROPIC_API_KEY', name: 'Anthropic (env var)' },
    }
    for (const [service, info] of Object.entries(envKeyMap)) {
      const hasKey = keys.some(k => k.service === service)
      if (!hasKey && process.env[info.envVar]) {
        keys.push({
            id: `env_${service}_${Date.now()}`,
            name: info.name,
            service,
            baseUrl: null,
            createdAt: new Date(),
          })
      }
    }

    return NextResponse.json({ keys })
  } catch (e: any) { return NextResponse.json({ keys: [], error: e?.message }, { status: 200 }) }
}

export async function POST(req: NextRequest) {
  try {
    await ensureDbReady()
    const userId = await getSessionUserId()
    if (!userId) return NextResponse.json({ error: 'User not found. Try refreshing the page.' }, { status: 401 })
    const body = await req.json()
    const { name, service, key, baseUrl } = body
    if (!name || !service || !key) return NextResponse.json({ error: 'name, service, key required' }, { status: 400 })

    const keyStr = key.toString()

    // Delete any existing key for this service first (avoid duplicates)
    try {
      await db.apiKey.deleteMany({ where: { userId, service } })
    } catch {}

    const id = `key_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const createdAt = new Date().toISOString()

    // Store in DB (may be wiped on Vercel cold start)
    let dbId = id
    try {
      const apiKey = await db.apiKey.create({ data: { userId, name, service, key: keyStr, baseUrl: baseUrl || null } })
      dbId = apiKey.id
    } catch {}

    // ALSO store in /tmp file (survives across instances within the same reuse window)
    // Remove old key for same service first
    const stored = readStoredKeys().filter(k => !(k.userId === userId && k.service === service))
    stored.push({ id: dbId, userId, name, service, key: keyStr, baseUrl: baseUrl || null, createdAt })
    writeStoredKeys(stored)

    // Set as env var for immediate use by the LLM fallback
    if (service === 'openai') {
      process.env.OPENAI_API_KEY = keyStr
      try { const { clearKeyCache } = await import('@/lib/llm-fallback'); clearKeyCache() } catch {}
    }

    return NextResponse.json({
      ok: true,
      key: { id: dbId, name, service },
      message: `Key saved to DB + /tmp file + process.env. On Vercel cold starts, the key auto-seeds from the OPENAI_API_KEY env var. For permanent persistence, ensure OPENAI_API_KEY is set in Vercel → Settings → Environment Variables.`,
    })
  } catch (e: any) { return NextResponse.json({ error: e?.message ?? 'Failed to save key' }, { status: 500 }) }
}

// Owner authorization required for delete operations
async function checkOwnerAuth(operation: string, req: any): Promise<{ ok: boolean; error?: string }> {
  try {
    const authHeader = req.headers.get('x-owner-auth')
    if (authHeader) {
      const { authId, code } = JSON.parse(authHeader)
      const result = verifyOwnerAuthorization(authId, code)
      if (!result.ok) return { ok: false, error: result.message }
      return { ok: true }
    }
  } catch {}
  const authResult = await requestOwnerAuthorization(operation)
  return { ok: false, error: 'OWNER_AUTH_REQUIRED:' + JSON.stringify(authResult) }
}

export async function DELETE(req: NextRequest) {
  try {
    await ensureDbReady()
    const url = new URL(req.url)
    const id = url.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    await db.apiKey.delete({ where: { id } }).catch(() => {})

    // Also remove from /tmp file
    const stored = readStoredKeys().filter(k => k.id !== id)
    writeStoredKeys(stored)

    return NextResponse.json({ ok: true })
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }) }
}
