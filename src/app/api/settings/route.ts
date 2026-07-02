import { db, ensureDbReady } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import {
  getIncomeSettings,
  setIncomeSettings,
  getNotificationSettings,
  setNotificationSettings,
  type IncomeSettings,
  type NotificationSettings,
} from '@/lib/settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/settings — return current income + notification settings. */
export async function GET() {
  try {
    await ensureDbReady().catch(() => {})
    const [income, notif] = await Promise.all([
      getIncomeSettings(),
      getNotificationSettings(),
    ])
    return NextResponse.json({ income, notifications: notif, smtpConfigured: !!(process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_USER && process.env.SMTP_PASS) })
  } catch (e: any) {
    console.error('[settings GET]', e)
    return NextResponse.json(
      { error: e?.message ?? 'Failed to load settings' },
      { status: 500 }
    )
  }
}

/** PUT /api/settings — update income and/or notification settings. */
export async function PUT(req: NextRequest) {
  try {
    await ensureDbReady().catch(() => {})
    const body = await req.json().catch(() => ({}))
    const { income, notifications } = body as {
      income?: Partial<IncomeSettings>
      notifications?: Partial<NotificationSettings>
    }
    if (income) {
      const current = await getIncomeSettings()
      const merged: IncomeSettings = { ...current, ...income }
      // sanitize
      if (typeof merged.monthlyGoal !== 'number' || !isFinite(merged.monthlyGoal) || merged.monthlyGoal < 0) {
        merged.monthlyGoal = current.monthlyGoal
      }
      if (typeof merged.dailyGrowthTarget !== 'number' || !isFinite(merged.dailyGrowthTarget)) {
        merged.dailyGrowthTarget = current.dailyGrowthTarget
      }
      if (typeof merged.currencySymbol !== 'string' || !merged.currencySymbol.trim()) {
        merged.currencySymbol = current.currencySymbol
      }
      if (merged.displayMode !== 'compact' && merged.displayMode !== 'detailed') {
        merged.displayMode = current.displayMode
      }
      merged.currencySymbol = merged.currencySymbol.slice(0, 4)
      await setIncomeSettings(merged)
    }
    if (notifications) {
      const current = await getNotificationSettings()
      const merged: NotificationSettings = {
        ...current,
        ...notifications,
        events: { ...current.events, ...(notifications.events ?? {}) },
      }
      if (typeof merged.minDelayMinutes !== 'number' || merged.minDelayMinutes < 0) {
        merged.minDelayMinutes = current.minDelayMinutes
      }
      if (typeof merged.email !== 'string' || !merged.email.includes('@')) {
        merged.email = current.email
      }
      await setNotificationSettings(merged)
    }
    const [updatedIncome, updatedNotif] = await Promise.all([
      getIncomeSettings(),
      getNotificationSettings(),
    ])
    return NextResponse.json({ ok: true, income: updatedIncome, notifications: updatedNotif })
  } catch (e: any) {
    console.error('[settings PUT]', e)
    return NextResponse.json(
      { error: e?.message ?? 'Failed to save settings' },
      { status: 500 }
    )
  }
}
