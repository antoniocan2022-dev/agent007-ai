import { db } from '/home/z/my-project/src/lib/db'
import bcrypt from 'bcryptjs'

async function check() {
  await db.$connect().catch(() => {})
  const user = await db.user.findUnique({ where: { email: 'antonio.can2022@hotmail.com' } })
  if (!user) {
    console.log('User not found')
    process.exit(1)
  }
  console.log('User found:', user.email)
  
  // Test seed password
  const matches = await bcrypt.compare('antonio.can2022@hotmail.com', user.passwordHash)
  console.log('Seed password matches:', matches)
  
  // Test other common passwords
  for (const pw of ['antonio', 'password', 'Agent007', 'admin', 'antonio.can2022']) {
    const m = await bcrypt.compare(pw, user.passwordHash)
    console.log(`  ${pw}: ${m}`)
  }
  
  process.exit(0)
}
check().catch(e => { console.error(e); process.exit(1) })
