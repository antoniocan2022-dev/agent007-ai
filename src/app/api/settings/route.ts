import { NextRequest, NextResponse } from 'next/server'
import { db, ensureDbReady } from '@/lib/db'
import {
  getIncomeSettings,
  setIncomeSettings,
  getNotificationSettings,
  setNotificationSettings,
  getOperatorUserId,
  type IncomeSettings,
  type NotificationSettings,
} from '@/lib/settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/* ------------------------------------------------------------------ *
 * Universal settings endpoint.
 *
 * GET  /api/settings                  → returns { income, notifications, smtpConfigured, version, lastUpdated, custom }
 * PUT  /api/settings                  → body: { income?, notifications?, custom? }
 * GET  /api/settings?key=dashboard.refreshInterval
 * PUT  /api/settings                  → body: { custom: { key: value, ... } } — store any custom key/value
 *
 * `custom` is a free-form namespace for Agent007 to store ANY dashboard/login
 * configuration without schema migrations. Stored in UserSetting with the
 * `custom:` prefix.
 * ------------------------------------------------------------------ */

const CUSTOM_PREFIX = 'custom:'

export async function GET(req: NextRequest) {
  const errors: string[] = []
  try {
    await ensureDbReady()
  } catch (e: any) {
    errors.push(`db_init: ${e?.message ?? e}`)
  }

  try {
    const [income, notif, custom] = await Promise.all([
      getIncomeSettings().catch((e) => {
        errors.push(`income: ${e?.message ?? e}`)
        return null
      }),
      getNotificationSettings().catch((e) => {
        errors.push(`notif: ${e?.message ?? e}`)
        return null
      }),
      getAllCustomSettings().catch((e) => {
        errors.push(`custom: ${e?.message ?? e}`)
        return {} as Record<string, any>
      }),
    ])

    const safeIncome: IncomeSettings = income ?? {
      monthlyGoal: 20000,
      dailyGrowthTarget: 20,
      currencySymbol: '$',
      displayMode: 'detailed',
    }
    const safeNotif: NotificationSettings = notif ?? {
      enabled: false,
      email: 'OWNER_EMAIL',
      events: {
        mission_complete: true,
        mission_failed: true,
        income_logged: false,
        daily_summary: true,
        weekly_summary: false,
      },
      minDelayMinutes: 5,
    }

    return NextResponse.json({
      income: safeIncome,
      notifications: safeNotif,
      custom: custom ?? {},
      smtpConfigured: !!(process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_USER && process.env.SMTP_PASS),
      version: Date.now().toString(),
      lastUpdated: new Date().toISOString(),
      errors: errors.length > 0 ? errors : undefined,
    })
  } catch (e: any) {
    return NextResponse.json({
      income: { monthlyGoal: 20000, dailyGrowthTarget: 20, currencySymbol: '$', displayMode: 'detailed' },
      notifications: {
        enabled: false,
        email: 'OWNER_EMAIL',
        events: {},
        minDelayMinutes: 5,
      },
      custom: {},
      smtpConfigured: !!(process.env.SMTP_HOST && process.env.SMTP_PORT),
      version: Date.now().toString(),
      lastUpdated: new Date().toISOString(),
      errors: [...errors, `top_level: ${e?.message ?? e}`],
    })
  }
}

export async function PUT(req: NextRequest) {
  const errors: string[] = []
  const changed: string[] = []
  try {
    await ensureDbReady()
  } catch (e: any) {
    errors.push(`db_init: ${e?.message ?? e}`)
  }

  try {
    const body = await req.json().catch(() => ({}))
    const { income, notifications, custom } = body as {
      income?: Partial<IncomeSettings>
      notifications?: Partial<NotificationSettings>
      custom?: Record<string, any>
    }

    if (income) {
      try {
        const current = await getIncomeSettings().catch(() => ({
          monthlyGoal: 20000,
          dailyGrowthTarget: 20,
          currencySymbol: '$',
          displayMode: 'detailed' as const,
        }))
        const merged: IncomeSettings = { ...current, ...income }
        if (typeof merged.monthlyGoal !== 'number' || !isFinite(merged.monthlyGoal) || merged.monthlyGoal < 0) {
          merged.monthlyGoal = 20000
        }
        if (typeof merged.dailyGrowthTarget !== 'number' || !isFinite(merged.dailyGrowthTarget)) {
          merged.dailyGrowthTarget = 20
        }
        if (typeof merged.currencySymbol !== 'string' || !merged.currencySymbol.trim()) {
          merged.currencySymbol = '$'
        }
        if (merged.displayMode !== 'compact' && merged.displayMode !== 'detailed') {
          merged.displayMode = 'detailed'
        }
        merged.currencySymbol = merged.currencySymbol.slice(0, 4)
        const r = await setIncomeSettings(merged)
        if (r === false) errors.push('income: persistence failed (file fallback used)')
        changed.push('income')
      } catch (e: any) {
        errors.push(`income: ${e?.message ?? e}`)
      }
    }

    if (notifications) {
      try {
        const current = await getNotificationSettings().catch(() => ({
          enabled: false,
          email: '',
          events: {},
          minDelayMinutes: 5,
        } as NotificationSettings))
        const merged: NotificationSettings = {
          ...current,
          ...notifications,
          events: { ...current.events, ...(notifications.events ?? {}) },
        }
        if (typeof merged.minDelayMinutes !== 'number' || merged.minDelayMinutes < 0) {
          merged.minDelayMinutes = 5
        }
        const r = await setNotificationSettings(merged)
        if (r === false) errors.push('notifications: persistence failed (file fallback used)')
        changed.push('notifications')
      } catch (e: any) {
        errors.push(`notifications: ${e?.message ?? e}`)
      }
    }

    if (custom && typeof custom === 'object') {
      try {
        const r = await setCustomSettings(custom)
        if (r === false) errors.push('custom: persistence failed (file fallback used)')
        changed.push('custom')
      } catch (e: any) {
        errors.push(`custom: ${e?.message ?? e}`)
      }
    }

    return NextResponse.json({
      ok: true,
      message: errors.length === 0
        ? `Settings saved (${changed.join(', ')}).`
        : `Settings saved with ${errors.length} warning(s): ${changed.join(', ')}.`,
      changed,
      errors: errors.length > 0 ? errors : undefined,
      version: Date.now().toString(),
      lastUpdated: new Date().toISOString(),
    })
  } catch (e: any) {
    console.error('[settings PUT]', e)
    return NextResponse.json(
      {
        ok: false,
        message: `Settings save failed: ${e?.message ?? e}`,
        error: e?.message ?? String(e),
      },
      { status: 500 }
    )
  }
}

/* ------------------------------------------------------------------ *
 * Custom key/value storage helpers.
 * Stored in UserSetting with `custom:` prefix on the key.
 * Falls back gracefully if DB is unavailable.
 * ------------------------------------------------------------------ */

async function getAllCustomSettings(): Promise<Record<string, any>> {
  const userId = await getOperatorUserId()
  if (!userId) return {}
  try {
    const rows = await db.userSetting.findMany({
      where: { userId, key: { startsWith: CUSTOM_PREFIX } },
    })
    const out: Record<string, any> = {}
    for (const row of rows) {
      const key = row.key.slice(CUSTOM_PREFIX.length)
      try {
        out[key] = JSON.parse(row.value)
      } catch {
        out[key] = row.value
      }
    }
    return out
  } catch {
    return {}
  }
}

async function setCustomSettings(values: Record<string, any>): Promise<boolean> {
  const userId = await getOperatorUserId()
  if (!userId) return false
  let allOk = true
  for (const [k, v] of Object.entries(values)) {
    if (!k) continue
    const safeKey = k.slice(0, 200)
    const fullKey = CUSTOM_PREFIX + safeKey
    const value = typeof v === 'string' ? v : JSON.stringify(v)
    try {
      try {
        await db.userSetting.deleteMany({ where: { userId, key: fullKey } })
      } catch {}
      try {
        await db.userSetting.create({ data: { userId, key: fullKey, value } })
      } catch (e: any) {
        // If create fails (e.g. unique constraint), try update
        try {
          await db.userSetting.updateMany({ where: { userId, key: fullKey }, data: { value } })
        } catch {
          allOk = false
        }
      }
    } catch {
      allOk = false
    }
  }
  return allOk
}
