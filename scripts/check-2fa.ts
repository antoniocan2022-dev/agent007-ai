import { db } from '../src/lib/db'

async function check() {
  const user = await db.user.findUnique({ where: { email: 'antonio.can2022@hotmail.com' } })
  if (!user) { console.log('User not found'); process.exit(1) }
  
  const configs = await db.twoFactorSecret.findMany({ where: { userId: user.id } })
  console.log(`Found ${configs.length} 2FA config(s):`)
  for (const c of configs) {
    console.log(`  - id=${c.id} method=${c.method} enabled=${c.enabled} phone=${c.phoneNumber} email=${c.email}`)
  }
  
  // Disable all 2FA so the user can log in
  if (configs.length > 0) {
    await db.twoFactorSecret.updateMany({
      where: { userId: user.id },
      data: { enabled: false },
    })
    console.log('\n✅ All 2FA configs DISABLED. User can now log in with just email + password.')
  }
  
  process.exit(0)
}
check().catch(e => { console.error(e); process.exit(1) })
