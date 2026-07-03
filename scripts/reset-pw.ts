import { db } from '../src/lib/db'
import bcrypt from 'bcryptjs'

async function reset() {
  await db.$connect().catch(() => {})
  const user = await db.user.findUnique({ where: { email: 'antonio.can2022@hotmail.com' } })
  if (!user) {
    console.log('User not found')
    process.exit(1)
  }
  
  // Reset to seed password (email === password)
  const salt = await bcrypt.genSalt(10)
  const passwordHash = await bcrypt.hash('antonio.can2022@hotmail.com', salt)
  await db.user.update({ where: { id: user.id }, data: { passwordHash } })
  
  // Verify
  const updated = await db.user.findUnique({ where: { email: 'antonio.can2022@hotmail.com' } })
  const matches = await bcrypt.compare('antonio.can2022@hotmail.com', updated!.passwordHash)
  console.log('Password reset to seed email.')
  console.log('Verification:', matches)
  
  process.exit(0)
}
reset().catch(e => { console.error(e); process.exit(1) })
