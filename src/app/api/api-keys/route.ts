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

    // Try DB first
    let keys = await db.apiKey.findMany({
      where: { userId },
      select: { id: true, name: true, service: true, baseUrl: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    }).catch(() => [])

    // If DB is empty, try /tmp file
    if (keys.length === 0) {
      const stored = readStoredKeys().filter(k => k.userId === userId)
      keys = stored.map(k => ({ id: k.id, name: k.name, service: k.service, baseUrl: k.baseUrl, createdAt: new Date(k.createdAt) }))
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
    const id = `key_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const createdAt = new Date().toISOString()

    // Store in DB (may be wiped on Vercel cold start)
    let dbId = id
    try {
      const apiKey = await db.apiKey.create({ data: { userId, name, service, key: keyStr, baseUrl: baseUrl || null } })
      dbId = apiKey.id
    } catch {}

    // ALSO store in /tmp file (survives across instances within the same reuse window)
    const stored = readStoredKeys()
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
      message: `Key saved. On Vercel, the key is also written to ${API_KEYS_FILE} for persistence across cold starts. For permanent persistence, set OPENAI_API_KEY as a Vercel env var.`,
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
