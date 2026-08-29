import { NextRequest, NextResponse } from 'next/server'
import { requestOwnerAuthorization, verifyOwnerAuthorization } from '@/lib/owner-auth'
import { db, ensureDbReady } from '@/lib/db'
import { getSessionUserId } from '@/lib/session-user'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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

    let keys: Array<{ id: string; name: string; service: string; baseUrl: string | null; createdAt: Date }> = []
    try {
      keys = await db.apiKey.findMany({
        where: { userId },
        select: { id: true, name: true, service: true, baseUrl: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      })
    } catch { keys = [] }

    if (keys.length === 0) {
      const stored = readStoredKeys().filter(k => k.userId === userId)
      keys = stored.map(k => ({ id: k.id, name: k.name, service: k.service, baseUrl: k.baseUrl, createdAt: new Date(k.createdAt) }))
    }

    const hasOpenAIKey = keys.some(k => k.service === 'openai')
    if (!hasOpenAIKey && process.env.OPENAI_API_KEY) {
      const envKey = process.env.OPENAI_API_KEY
      const virtualId = `env_openai_${Date.now()}`
      try {
        await db.apiKey.create({
          data: { userId, name: 'OpenAI (from Vercel env var)', service: 'openai', key: envKey, baseUrl: null },
        }).then((created: any) => {
          keys.unshift({ id: created.id, name: 'OpenAI (from Vercel env var)', service: 'openai', baseUrl: null, createdAt: created.createdAt })
        })
      } catch {
        keys.unshift({ id: virtualId, name: 'OpenAI (from Vercel env var)', service: 'openai', baseUrl: null, createdAt: new Date() })
      }

      try {
        const stored = readStoredKeys()
        const alreadyInFile = stored.some(k => k.service === 'openai' && k.userId === userId)
        if (!alreadyInFile) {
          stored.push({ id: virtualId, userId, name: 'OpenAI (from Vercel env var)', service: 'openai', key: envKey, baseUrl: null, createdAt: new Date().toISOString() })
          writeStoredKeys(stored)
        }
      } catch {}

      try {
        const { clearKeyCache } = await import('@/lib/llm-fallback')
        clearKeyCache()
      } catch {}
    }

    const envKeyMap: Record<string, { envVar: string; name: string }> = {
      openai: { envVar: 'OPENAI_API_KEY', name: 'OpenAI (env var)' },
      resend: { envVar: 'RESEND_API_KEY', name: 'Resend (env var)' },
      callmebot: { envVar: 'CALLMEBOT_API_KEY', name: 'CallMeBot (env var)' },
      anthropic: { envVar: 'ANTHROPIC_API_KEY', name: 'Anthropic (env var)' },
    }
    for (const [service, info] of Object.entries(envKeyMap)) {
      if (!keys.some(k => k.service === service) && process.env[info.envVar]) {
        keys.push({ id: `env_${service}_${Date.now()}`, name: info.name, service, baseUrl: null, createdAt: new Date() })
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

    try { await db.apiKey.deleteMany({ where: { userId, service } }) } catch {}

    const id = `key_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const createdAt = new Date().toISOString()
    let dbId = id
    try {
      const apiKey = await db.apiKey.create({ data: { userId, name, service, key: keyStr, baseUrl: baseUrl || null } })
      dbId = apiKey.id
    } catch {}

    const stored = readStoredKeys().filter(k => !(k.userId === userId && k.service === service))
    stored.push({ id: dbId, userId, name, service, key: keyStr, baseUrl: baseUrl || null, createdAt })
    writeStoredKeys(stored)

    if (service === 'openai') {
      process.env.OPENAI_API_KEY = keyStr
      try { const { clearKeyCache } = await import('@/lib/llm-fallback'); clearKeyCache() } catch {}
    }

    return NextResponse.json({ ok: true, key: { id: dbId, name, service }, message: 'Key saved securely for the authenticated account.' })
  } catch (e: any) { return NextResponse.json({ error: e?.message ?? 'Failed to save key' }, { status: 500 }) }
}

export async function DELETE(req: NextRequest) {
  try {
    await ensureDbReady()
    const userId = await getSessionUserId()
    if (!userId) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 })
    const url = new URL(req.url)
    const id = url.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    const key = await db.apiKey.findFirst({ where: { id, userId }, select: { id: true } })
    if (!key) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await db.apiKey.delete({ where: { id: key.id } })
    const stored = readStoredKeys().filter(k => !(k.id === id && k.userId === userId))
    writeStoredKeys(stored)
    return NextResponse.json({ ok: true })
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }) }
}