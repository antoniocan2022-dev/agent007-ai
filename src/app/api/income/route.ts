import { NextRequest, NextResponse } from 'next/server'
import { db, ensureDbReady } from '@/lib/db'
import { getOperatorUserId } from '@/lib/settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/income — list income entries, optionally filtered by date range.
 *  Auto-seeds 4 sample IncomeEntry rows on first GET if the table is empty
 *  (source="Sample", notes="Demo entry — delete me"). */
export async function GET(req: NextRequest) {
  try {
    await ensureDbReady().catch(() => {})
    const url = new URL(req.url)
    const fromStr = url.searchParams.get('from')
    const toStr = url.searchParams.get('to')
    const limit = parseInt(url.searchParams.get('limit') ?? '100', 10)
    const source = url.searchParams.get('source')

    // Auto-seed samples if the table is empty (first-load behavior)
    try {
      const count = await db.incomeEntry.count()
      if (count === 0) {
        await seedSampleIncome()
      }
    } catch (seedErr) {
      console.error('[income GET] auto-seed failed:', seedErr)
    }

    const where: any = {}
    if (fromStr || toStr) {
      where.date = {}
      if (fromStr) where.date.gte = new Date(fromStr)
      if (toStr) where.date.lte = new Date(toStr)
    }
    if (source) where.source = source

    const entries = await db.incomeEntry.findMany({
      where,
      orderBy: { date: 'desc' },
      take: Math.min(Math.max(limit, 1), 1000),
    })

    // Compute today/yesterday/7-day/this-month aggregates
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const todayEnd = new Date(todayStart.getTime() + 24 * 3600 * 1000)
    const yesterdayStart = new Date(todayStart.getTime() - 24 * 3600 * 1000)
    const sevenDaysAgo = new Date(todayStart.getTime() - 6 * 24 * 3600 * 1000)
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

    const allEntries = await db.incomeEntry.findMany({ orderBy: { date: 'asc' } })

    const todayTotal = allEntries
      .filter((e) => e.date >= todayStart && e.date < todayEnd)
      .reduce((s, e) => s + e.amount, 0)
    const yesterdayTotal = allEntries
      .filter((e) => e.date >= yesterdayStart && e.date < todayStart)
      .reduce((s, e) => s + e.amount, 0)
    const monthTotal = allEntries
      .filter((e) => e.date >= monthStart)
      .reduce((s, e) => s + e.amount, 0)
    const last7 = allEntries.filter((e) => e.date >= sevenDaysAgo)
    // Group last 7 days by day for the sparkline
    const days: Array<{ date: string; label: string; total: number }> = []
    for (let i = 0; i < 7; i++) {
      const dStart = new Date(todayStart.getTime() - (6 - i) * 24 * 3600 * 1000)
      const dEnd = new Date(dStart.getTime() + 24 * 3600 * 1000)
      const total = allEntries
        .filter((e) => e.date >= dStart && e.date < dEnd)
        .reduce((s, e) => s + e.amount, 0)
      days.push({
        date: dStart.toISOString(),
        label: dStart.toLocaleDateString('en-US', { weekday: 'short' }),
        total,
      })
    }

    return NextResponse.json({
      entries,
      aggregates: {
        today: todayTotal,
        yesterday: yesterdayTotal,
        month: monthTotal,
        last7Days: days,
        total: allEntries.reduce((s, e) => s + e.amount, 0),
        count: allEntries.length,
        last7Total: last7.reduce((s, e) => s + e.amount, 0),
      },
    })
  } catch (e: any) {
    console.error('[income GET]', e)
    return NextResponse.json(
      { error: e?.message ?? 'Failed to list income entries' },
      { status: 500 }
    )
  }
}

/** POST /api/income — create a new income entry. */
export async function POST(req: NextRequest) {
  try {
    await ensureDbReady().catch(() => {})
    const body = await req.json().catch(() => ({}))
    const { amount, source, notes, date, seedIfEmpty } = body as {
      amount?: number
      source?: string
      notes?: string
      date?: string
      seedIfEmpty?: boolean
    }

    // Seed-if-empty mode: only used internally by the orchestrator/dashboard
    // to ensure the dashboard isn't blank on first load.
    if (seedIfEmpty) {
      const count = await db.incomeEntry.count()
      if (count > 0) {
        return NextResponse.json({ ok: true, seeded: false, message: 'already populated' })
      }
      await seedSampleIncome()
      return NextResponse.json({ ok: true, seeded: true })
    }

    if (typeof amount !== 'number' || !isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: 'amount must be a positive number' }, { status: 400 })
    }
    const src = (source ?? 'manual').toString().trim() || 'manual'
    const safeNotes = notes ? notes.toString().slice(0, 500) : null
    const d = date ? new Date(date) : new Date()
    if (isNaN(d.getTime())) {
      return NextResponse.json({ error: 'invalid date' }, { status: 400 })
    }
    const entry = await db.incomeEntry.create({
      data: { amount, source: src, notes: safeNotes, date: d },
    })

    // Fire-and-forget: notify on income-logged if enabled
    try {
      const { getNotificationSettings, recentlyNotified } = await import('@/lib/settings')
      const notif = await getNotificationSettings()
      if (notif.enabled && notif.events.income_logged && !(await recentlyNotified('income_logged', notif.minDelayMinutes))) {
        const { sendEmail } = await import('@/lib/email')
        const userId = await getOperatorUserId()
        sendEmail({
          to: notif.email,
          subject: `Income Logged: ${src} +$${amount.toFixed(2)}`,
          body: `Agent007 logged a new income entry.\n\nSource: ${src}\nAmount: $${amount.toFixed(2)}\nDate: ${d.toUTCString()}\n${safeNotes ? `Notes: ${safeNotes}\n` : ''}\nView the dashboard at / for details.`,
          userId: userId ?? undefined,
          type: 'income_logged',
        }).catch(() => {/* ignore */})
      }
    } catch {/* ignore */}

    return NextResponse.json({ ok: true, entry })
  } catch (e: any) {
    console.error('[income POST]', e)
    return NextResponse.json(
      { error: e?.message ?? 'Failed to create income entry' },
      { status: 500 }
    )
  }
}

/** DELETE /api/income?id=... — delete one income entry. */
export async function DELETE(req: NextRequest) {
  try {
    await ensureDbReady().catch(() => {})
    const url = new URL(req.url)
    const id = url.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    await db.incomeEntry.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error('[income DELETE]', e)
    return NextResponse.json(
      { error: e?.message ?? 'Failed to delete income entry' },
      { status: 500 }
    )
  }
}

/** Insert a few clearly-fake sample entries so the dashboard isn't blank. */
async function seedSampleIncome() {
  const now = new Date()
  const samples = [
    {
      amount: 12.5,
      source: 'Sample',
      notes: 'Demo entry — delete me',
      date: new Date(now.getTime() - 6 * 24 * 3600 * 1000 + 8 * 3600 * 1000),
    },
    {
      amount: 8.25,
      source: 'Sample',
      notes: 'Demo entry — delete me',
      date: new Date(now.getTime() - 4 * 24 * 3600 * 1000 + 11 * 3600 * 1000),
    },
    {
      amount: 15.0,
      source: 'Sample',
      notes: 'Demo entry — delete me',
      date: new Date(now.getTime() - 2 * 24 * 3600 * 1000 + 14 * 3600 * 1000),
    },
    {
      amount: 9.75,
      source: 'Sample',
      notes: 'Demo entry — delete me',
      date: new Date(now.getTime() - 1 * 24 * 3600 * 1000 + 9 * 3600 * 1000),
    },
  ]
  for (const s of samples) {
    await db.incomeEntry.create({ data: s })
  }
}
