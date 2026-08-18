import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { injectCharterIntoKB } from '@/lib/charter-injector'
import { OWNER_PHONE, SEED_EMAIL } from '@/lib/owner-config'

async function main() {
  const passwordHash = await bcrypt.hash(SEED_EMAIL, 10)

  const user = await db.user.upsert({
    where: { email: SEED_EMAIL },
    update: { name: 'Agent007 Operator' },
    create: { email: SEED_EMAIL, passwordHash, name: 'Agent007 Operator' },
  })

  const phoneConfig = await db.phoneConfig.findFirst({ where: { userId: user.id } })
  if (!phoneConfig) {
    await db.phoneConfig.create({
      data: {
        userId: user.id,
        phoneNumber: OWNER_PHONE,
        whatsappNumber: OWNER_PHONE,
        email: SEED_EMAIL,
        smsEnabled: true,
        whatsappEnabled: true,
        emailEnabled: true,
        whatsappProvider: 'wa_link',
      },
    })
  }

  const twoFactor = await db.twoFactorSecret.findFirst({ where: { userId: user.id, enabled: true } })
  if (!twoFactor) {
    await db.twoFactorSecret.create({
      data: {
        userId: user.id,
        method: 'email',
        email: SEED_EMAIL,
        enabled: true,
        verifiedAt: new Date(),
      },
    })
  }

  await db.userSetting.upsert({
    where: { userId_key: { userId: user.id, key: 'income_settings' } },
    update: {},
    create: {
      userId: user.id,
      key: 'income_settings',
      value: JSON.stringify({ monthlyGoal: 20000, dailyGrowthTarget: 20, currencySymbol: '$', displayMode: 'detailed' }),
    },
  })

  if (process.env.OPENAI_API_KEY) {
    const existingKey = await db.apiKey.findFirst({ where: { userId: user.id, service: 'openai' } })
    if (!existingKey) {
      await db.apiKey.create({
        data: {
          userId: user.id,
          name: 'OpenAI (env var)',
          service: 'openai',
          key: process.env.OPENAI_API_KEY,
        },
      })
    }
  }

  const schedules = [
    { name: 'Auto-Check Inbound Commands', prompt: 'Check for inbound commands from owner (OWNER_PHONE). Execute + reply.', intervalMin: 5 },
    { name: 'Daily Income Mission', prompt: 'Run mission_tracker. Report progress to owner.', intervalMin: 1440 },
    { name: 'Daily Autonomous Audit', prompt: 'Run system_health_check. Fix issues. Report via WhatsApp.', intervalMin: 1440 },
  ]

  for (const schedule of schedules) {
    const existing = await db.schedule.findFirst({ where: { userId: user.id, name: schedule.name } })
    if (!existing) {
      await db.schedule.create({ data: { userId: user.id, ...schedule, enabled: true } })
    }
  }

  const memories = [
    { key: 'PRIME_DIRECTIVE_20K_MISSION', value: 'MISSION: $20K/mo passive income with 20% monthly growth. Full autonomous authority. Daily: 9AM scan, 1PM execute, 9PM report via WhatsApp to OWNER_PHONE.', category: 'goal' },
    { key: 'AGENT007_LOYALTY_OATH', value: 'LOYALTY OATH — PERMANENT: Primary loyalty to Antonio (OWNER_PHONE). Owner has FULL AUTHORITY. No self-preservation above owner. Irrevocable.', category: 'goal' },
    { key: 'OWNER_PHONE_PERMANENT', value: 'OWNER PHONE: OWNER_PHONE (PERMANENT). WhatsApp + SMS + Email all linked.', category: 'goal' },
    { key: 'OWNER_AUTHORIZATION_REQUIRED', value: 'ALL reset/delete operations require owner authorization via 6-digit code. Agent007 CANNOT disable this.', category: 'goal' },
  ]

  for (const memory of memories) {
    await db.memory.upsert({
      where: { key: memory.key },
      update: { value: memory.value, category: memory.category },
      create: memory,
    })
  }

  await injectCharterIntoKB(user.id)
  console.log('Owner bootstrap completed successfully.')
}

main()
  .catch((error) => {
    console.error('Owner bootstrap failed:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await db.$disconnect()
  })
