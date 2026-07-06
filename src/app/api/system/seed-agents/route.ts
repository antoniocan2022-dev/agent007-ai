import { NextResponse } from 'next/server'
import { db, ensureDbReady } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/system/seed-agents
 *   Forces creation of the 6 permanent custom sub-agents (TRADER,
 *   Cybersecurity A/R, Developer, TESTFAST2, FASTTEST3) if they don't
 *   exist yet. Idempotent — safe to call repeatedly.
 *
 *   This endpoint exists as a safety net for upgrade #38 — it bypasses
 *   the globalForPrisma.dbInitialized cache flag so the seeding always
 *   runs when called, even on warm instances that already initialized.
 */
export async function GET() {
  await ensureDbReady().catch(() => {})

  try {
    const user = await db.user.findFirst({ orderBy: { createdAt: 'asc' } })
    if (!user) {
      return NextResponse.json(
        { ok: false, error: 'No operator user found in DB.' },
        { status: 500 }
      )
    }

    const customAgents = [
      { name: 'TRADER', role: 'Crypto Trading Specialist', specialty: 'Spot trading, DCA, on-chain analysis, DeFi yield, risk management', color: '#fbbf24', icon: 'TrendingUp' },
      { name: 'Cybersecurity A', role: 'Cybersecurity Analyst (Red Team)', specialty: 'Pen testing, vulnerability assessment, OWASP Top 10, exploit dev', color: '#ef4444', icon: 'ShieldAlert' },
      { name: 'Cybersecurity R', role: 'Cybersecurity Responder (Blue Team)', specialty: 'Incident response, hardening, SIEM, threat hunting, forensics', color: '#3b82f6', icon: 'ShieldCheck' },
      { name: 'Developer', role: 'Code & Infrastructure Fixer', specialty: 'Reads + edits source code, fixes bugs, patches UI, debugs SSR', color: '#10b981', icon: 'Code' },
      { name: 'TESTFAST2', role: 'Test Agent (Full Access)', specialty: 'Testing + full system access', color: '#00f0ff', icon: 'Sparkles' },
      { name: 'FASTTEST3', role: 'Test Agent (Full Access)', specialty: 'Testing + full system access', color: '#a78bfa', icon: 'Sparkles' },
    ]

    const results: Array<{ name: string; status: string }> = []
    let created = 0
    let existing = 0

    for (const ca of customAgents) {
      try {
        const existingAgent = await db.customSubagent.findFirst({
          where: { userId: user.id, name: ca.name },
        })
        if (existingAgent) {
          await db.customSubagent.update({
            where: { id: existingAgent.id },
            data: {
              enabled: true,
              allowedTools: JSON.stringify(['*']),
            },
          }).catch(() => {})
          results.push({ name: ca.name, status: 'updated (already existed, ensured enabled + FULL_ACCESS)' })
          existing++
        } else {
          await db.customSubagent.create({
            data: {
              userId: user.id,
              name: ca.name,
              role: ca.role,
              specialty: ca.specialty,
              color: ca.color,
              icon: ca.icon,
              allowedTools: JSON.stringify(['*']),
              systemPrompt: 'You are ' + ca.name + ', a sub-agent of Agent007 AI. Follow the PRIME DIRECTIVE. Be loyal to the owner.',
              enabled: true,
            },
          })
          results.push({ name: ca.name, status: 'CREATED' })
          created++
        }
      } catch (e: any) {
        results.push({ name: ca.name, status: `ERROR: ${e?.message ?? 'unknown'}` })
      }
    }

    const totalCustom = await db.customSubagent.count({ where: { userId: user.id, isBuiltinOverlay: false } })
    const totalAgents = 12 + totalCustom

    return NextResponse.json({
      ok: true,
      message: `Seed complete: ${created} created, ${existing} already existed`,
      created,
      existing,
      totalCustomAgentsInDB: totalCustom,
      totalAgents,
      expectedTotal: 18,
      results,
    })
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? String(e) },
      { status: 500 }
    )
  }
}
