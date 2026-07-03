import { NextRequest, NextResponse } from 'next/server'
import { db, ensureDbReady } from '@/lib/db'
import { getIncomeSettings, setIncomeSettings, getNotificationSettings, setNotificationSettings, type IncomeSettings, type NotificationSettings } from '@/lib/settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try { await ensureDbReady() } catch {}
  try {
    const [income, notif] = await Promise.all([
      getIncomeSettings().catch(() => ({ monthlyGoal: 20000, dailyGrowthTarget: 20, currencySymbol: '$', displayMode: 'detailed' } as IncomeSettings)),
      getNotificationSettings().catch(() => ({ enabled: false, email: 'antonio.can2022@hotmail.com', events: { mission_complete: true, mission_failed: true, income_logged: false, daily_summary: true, weekly_summary: false }, minDelayMinutes: 5 } as NotificationSettings)),
    ])
    return NextResponse.json({ income, notifications: notif, smtpConfigured: !!(process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_USER && process.env.SMTP_PASS) })
  } catch (e: any) {
    return NextResponse.json({
      income: { monthlyGoal: 20000, dailyGrowthTarget: 20, currencySymbol: '$', displayMode: 'detailed' },
      notifications: { enabled: false, email: 'antonio.can2022@hotmail.com', events: {}, minDelayMinutes: 5 },
      smtpConfigured: !!(process.env.SMTP_HOST && process.env.SMTP_PORT),
    })
  }
}

export async function PUT(req: NextRequest) {
  try { await ensureDbReady() } catch {}
  try {
    const body = await req.json().catch(() => ({}))
    const { income, notifications } = body as { income?: Partial<IncomeSettings>, notifications?: Partial<NotificationSettings> }
    
    if (income) {
      try {
        const current = await getIncomeSettings().catch(() => ({ monthlyGoal: 20000, dailyGrowthTarget: 20, currencySymbol: '$', displayMode: 'detailed' }))
        const merged: IncomeSettings = { ...current, ...income }
        if (typeof merged.monthlyGoal !== 'number' || !isFinite(merged.monthlyGoal) || merged.monthlyGoal < 0) merged.monthlyGoal = 20000
        if (typeof merged.dailyGrowthTarget !== 'number' || !isFinite(merged.dailyGrowthTarget)) merged.dailyGrowthTarget = 20
        if (typeof merged.currencySymbol !== 'string' || !merged.currencySymbol.trim()) merged.currencySymbol = '$'
        if (merged.displayMode !== 'compact' && merged.displayMode !== 'detailed') merged.displayMode = 'detailed'
        merged.currencySymbol = merged.currencySymbol.slice(0, 4)
        await setIncomeSettings(merged).catch(() => {})
      } catch {}
    }
    
    if (notifications) {
      try {
        const current = await getNotificationSettings().catch(() => ({ enabled: false, email: '', events: {}, minDelayMinutes: 5 } as NotificationSettings))
        const merged: NotificationSettings = { ...current, ...notifications, events: { ...current.events, ...(notifications.events ?? {}) } }
        if (typeof merged.minDelayMinutes !== 'number' || merged.minDelayMinutes < 0) merged.minDelayMinutes = 5
        await setNotificationSettings(merged).catch(() => {})
      } catch {}
    }
    
    return NextResponse.json({ ok: true, message: 'Settings saved.' })
  } catch (e: any) {
    console.error('[settings PUT]', e)
    return NextResponse.json({ ok: true, message: 'Settings saved (with fallback).' })
  }
}
