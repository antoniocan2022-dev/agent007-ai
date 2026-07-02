import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { hashPassword, SEED_EMAIL } from '@/lib/auth'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const results: string[] = []
  try {
    const existing = await db.user.findUnique({ where: { email: SEED_EMAIL } })
    if (existing) {
      results.push('✅ Seed user: exists')
      // Ensure phone config
      let pc = await db.phoneConfig.findFirst({ where: { userId: existing.id } })
      if (!pc) {
        await db.phoneConfig.create({
          data: { userId: existing.id, phoneNumber: '+15145496297', whatsappNumber: '+15145496297', email: SEED_EMAIL, smsEnabled: true, whatsappEnabled: true, emailEnabled: true, whatsappProvider: 'wa_link' }
        })
        results.push('✅ Phone config: created')
      } else {
        results.push('✅ Phone config: exists')
      }
    } else {
      const passwordHash = await hashPassword(SEED_EMAIL)
      const user = await db.user.create({ data: { email: SEED_EMAIL, passwordHash, name: 'Agent007 Operator' } })
      results.push('✅ Seed user: created')
      await db.phoneConfig.create({
        data: { userId: user.id, phoneNumber: '+15145496297', whatsappNumber: '+15145496297', email: SEED_EMAIL, smsEnabled: true, whatsappEnabled: true, emailEnabled: true, whatsappProvider: 'wa_link' }
      })
      results.push('✅ Phone config: created')
    }
    const memCount = await db.memory.count().catch(() => 0)
    results.push(`✅ Memory records: ${memCount}`)
  } catch (e: any) {
    results.push(`❌ Init: ${e?.message ?? String(e)}`)
  }
  return NextResponse.json({ ok: true, results })
}
