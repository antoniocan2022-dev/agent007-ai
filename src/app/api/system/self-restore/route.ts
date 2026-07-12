import { NextRequest, NextResponse } from 'next/server'
import { db, ensureDbReady } from '@/lib/db'
import { getOperatorUserId } from '@/lib/settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * /api/system/self-restore — Owner-only endpoint for restoring data from a backup.
 *
 * UPGRADE #62 — Enables the Super Agent to restore itself from a backup file.
 *
 * AUTH:
 *   - Token-based (same token as /api/owner-backup)
 *   - Token = OWNER_BACKUP_TOKEN env var (or hardcoded fallback)
 *   - Constant-time comparison (prevents timing attacks)
 *   - 403 Forbidden on missing/wrong token
 *
 * USAGE:
 *   POST /api/system/self-restore?token=<TOKEN>
 *   Content-Type: application/json
 *   Body: {
 *     backup: { ...backup object... },     // inline backup
 *     OR
 *     backupUrl: "https://..."             // fetch backup from URL
 *   }
 *
 * WHAT GETS RESTORED:
 *   - Memory table (key + value + category) — upserted
 *   - CustomSubagent table (overlay only — builtin agents are code-defined)
 *   - UserSetting table (key + value) — upserted
 *   - Schedule table (name + prompt + interval) — upserted
 *   - IncomeEntry table (amount + source + date) — recreated
 *
 * WHAT DOES NOT GET RESTORED:
 *   - User accounts (security — cannot create users via restore)
 *   - AuditLog (immutable history)
 *   - NotificationLog (immutable history)
 *
 * RESPONSE:
 *   {
 *     "ok": true,
 *     "restored": {
 *       "memories": N,
 *       "subagents": N,
 *       "settings": N,
 *       "schedules": N,
 *       "income": N
 *     },
 *     "skipped": [...],
 *     "errors": [...]
 *   }
 */
const OWNER_BACKUP_TOKEN =
  process.env.OWNER_BACKUP_TOKEN || 'agent007-owner-backup-2024-antonio-can-2022'

function isValidToken(provided: string | null): boolean {
  if (!provided) return false
  const expected = OWNER_BACKUP_TOKEN
  if (provided.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i)
  }
  return diff === 0
}

interface RestoreResult {
  ok: boolean
  restored: {
    memories: number
    subagents: number
    settings: number
    schedules: number
    income: number
  }
  skipped: string[]
  errors: string[]
}

export async function POST(req: NextRequest) {
  try {
    // ── Token auth ──────────────────────────────────────────────────────
    const url = new URL(req.url)
    const token = url.searchParams.get('token')
    if (!isValidToken(token)) {
      return NextResponse.json(
        { ok: false, error: 'Forbidden: missing or invalid token.' },
        { status: 403 }
      )
    }

    await ensureDbReady().catch(() => {})
    const userId = await getOperatorUserId().catch(() => null)
    if (!userId) {
      return NextResponse.json(
        { ok: false, error: 'No operator user found. Cannot restore.' },
        { status: 500 }
      )
    }

    // ── Parse backup from body or URL ──────────────────────────────────
    let body: any
    try {
      body = await req.json()
    } catch {
      return NextResponse.json(
        { ok: false, error: 'Invalid JSON body. Expected { backup: {...} } or { backupUrl: "..." }' },
        { status: 400 }
      )
    }

    let backup: any = body?.backup
    if (!backup && body?.backupUrl) {
      // Fetch backup from URL
      try {
        const res = await fetch(body.backupUrl, { signal: AbortSignal.timeout(30000) })
        if (!res.ok) {
          return NextResponse.json(
            { ok: false, error: `Failed to fetch backup from URL: ${res.status} ${res.statusText}` },
            { status: 502 }
          )
        }
        const text = await res.text()
        backup = JSON.parse(text)
      } catch (e: any) {
        return NextResponse.json(
          { ok: false, error: `Failed to fetch/parse backup from URL: ${e?.message}` },
          { status: 502 }
        )
      }
    }

    if (!backup || typeof backup !== 'object') {
      return NextResponse.json(
        { ok: false, error: 'No backup object found. Expected { backup: {...} } or { backupUrl: "..." }' },
        { status: 400 }
      )
    }

    // ── Restore each table ──────────────────────────────────────────────
    const result: RestoreResult = {
      ok: true,
      restored: { memories: 0, subagents: 0, settings: 0, schedules: 0, income: 0 },
      skipped: [],
      errors: [],
    }

    // The backup may have different structures depending on when it was made.
    // Try multiple known structures:
    // 1. { data: { memories: [...], customSubagents: [...], ... } } — /api/backup format (PLURAL keys)
    // 2. { database: { memories: [...], ... } } — createBackup() direct format (PLURAL)
    // 3. { database: { data: { memory: [...], userSetting: [...], ... } } } — createBackup() nested (SINGULAR keys, Prisma model names)
    // 4. { memories: [...] } — direct format
    const data = backup?.data ?? backup?.database?.data ?? backup?.database ?? backup

    // Helper: get an array from any of the possible key variants (plural + singular)
    const getArray = (...keys: string[]): any[] => {
      for (const k of keys) {
        if (Array.isArray(data?.[k])) return data[k]
      }
      return []
    }

    const memoriesArr = getArray('memories', 'memory')
    const subagentsArr = getArray('customSubagents', 'customSubagent')
    const settingsArr = getArray('userSettings', 'userSetting')
    const schedulesArr = getArray('schedules', 'schedule')
    const incomeArr = getArray('incomeEntries', 'incomeEntry')

    // ── Memory ──────────────────────────────────────────────────────────
    if (memoriesArr.length > 0) {
      for (const m of memoriesArr) {
        try {
          if (!m.key || !m.value) continue
          await db.memory.upsert({
            where: { key: m.key },
            create: { key: m.key, value: m.value, category: m.category || 'general' },
            update: { value: m.value, category: m.category || 'general' },
          })
          result.restored.memories++
        } catch (e: any) {
          result.errors.push(`memory ${m.key}: ${e?.message}`)
        }
      }
    } else {
      result.skipped.push('memories (not in backup)')
    }

    // ── CustomSubagent (overlay only) ───────────────────────────────────
    if (subagentsArr.length > 0) {
      for (const s of subagentsArr) {
        try {
          if (!s.id || !s.name) continue
          // Only restore overlays — built-in agents are code-defined
          if (s.isBuiltinOverlay) {
            await db.customSubagent.upsert({
              where: { id: s.id },
              create: {
                id: s.id,
                userId,
                name: s.name,
                role: s.role || '',
                specialty: s.specialty || '',
                color: s.color || '#00f0ff',
                icon: s.icon || 'Sparkles',
                allowedTools: s.allowedTools || '[]',
                systemPrompt: s.systemPrompt || '',
                enabled: s.enabled ?? true,
                isBuiltinOverlay: true,
              },
              update: {
                name: s.name,
                role: s.role,
                specialty: s.specialty,
                color: s.color,
                icon: s.icon,
                allowedTools: s.allowedTools,
                systemPrompt: s.systemPrompt,
                enabled: s.enabled,
              },
            })
            result.restored.subagents++
          }
        } catch (e: any) {
          result.errors.push(`subagent ${s.id}: ${e?.message}`)
        }
      }
    } else {
      result.skipped.push('customSubagents (not in backup)')
    }

    // ── UserSetting ─────────────────────────────────────────────────────
    if (settingsArr.length > 0) {
      for (const us of settingsArr) {
        try {
          if (!us.key || !us.value) continue
          await db.userSetting.upsert({
            where: { id: us.id || `${userId}_${us.key}` },
            create: { id: us.id || `${userId}_${us.key}`, userId, key: us.key, value: us.value },
            update: { value: us.value },
          })
          result.restored.settings++
        } catch (e: any) {
          result.errors.push(`setting ${us.key}: ${e?.message}`)
        }
      }
    } else {
      result.skipped.push('userSettings (not in backup)')
    }

    // ── Schedule ────────────────────────────────────────────────────────
    if (schedulesArr.length > 0) {
      for (const s of schedulesArr) {
        try {
          if (!s.name || !s.prompt) continue
          await db.schedule.upsert({
            where: { id: s.id || `${userId}_${s.name}` },
            create: {
              id: s.id || `${userId}_${s.name}`,
              userId,
              name: s.name,
              prompt: s.prompt,
              intervalMin: s.intervalMin || 1440,
              enabled: s.enabled ?? false,
              nextRunAt: s.nextRunAt ? new Date(s.nextRunAt) : null,
            },
            update: {
              prompt: s.prompt,
              intervalMin: s.intervalMin,
              enabled: s.enabled,
            },
          })
          result.restored.schedules++
        } catch (e: any) {
          result.errors.push(`schedule ${s.name}: ${e?.message}`)
        }
      }
    } else {
      result.skipped.push('schedules (not in backup)')
    }

    // ── IncomeEntry ─────────────────────────────────────────────────────
    if (incomeArr.length > 0) {
      for (const ie of incomeArr) {
        try {
          if (!ie.amount || !ie.source) continue
          await db.incomeEntry.create({
            data: {
              id: ie.id || undefined,
              amount: ie.amount,
              source: ie.source,
              notes: ie.notes || '',
              date: ie.date ? new Date(ie.date) : new Date(),
            },
          })
          result.restored.income++
        } catch (e: any) {
          result.errors.push(`income ${ie.source}: ${e?.message}`)
        }
      }
    } else {
      result.skipped.push('incomeEntries (not in backup)')
    }

    return NextResponse.json(result)
  } catch (e: any) {
    console.error('[self-restore] failed:', e)
    return NextResponse.json(
      { ok: false, error: e?.message ?? String(e), stack: e?.stack },
      { status: 500 }
    )
  }
}

/**
 * GET /api/system/self-restore?token=<TOKEN>
 * Returns the restore documentation + usage instructions.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const token = url.searchParams.get('token')
  if (!isValidToken(token)) {
    return NextResponse.json(
      { ok: false, error: 'Forbidden: missing or invalid token.' },
      { status: 403 }
    )
  }
  return NextResponse.json({
    ok: true,
    endpoint: '/api/system/self-restore',
    method: 'POST',
    auth: 'token-based (same as /api/owner-backup)',
    usage: {
      inline: 'POST /api/system/self-restore?token=TOKEN with body { backup: {...} }',
      fromUrl: 'POST /api/system/self-restore?token=TOKEN with body { backupUrl: "https://..." }',
    },
    restores: ['memories', 'customSubagents (overlay only)', 'userSettings', 'schedules', 'incomeEntries'],
    doesNotRestore: ['User accounts (security)', 'AuditLog (immutable)', 'NotificationLog (immutable)'],
    example: {
      method: 'POST',
      url: '/api/system/self-restore?token=<TOKEN>',
      body: { backupUrl: 'https://agent007-ai.vercel.app/api/owner-backup?token=<TOKEN>&format=json' },
    },
  })
}
