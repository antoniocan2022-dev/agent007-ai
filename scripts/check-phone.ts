import { db } from '../src/lib/db'
async function check() {
  const pc = await db.phoneConfig.findFirst()
  if (pc) {
    console.log('  Phone: ' + pc.phoneNumber)
    console.log('  WhatsApp: ' + pc.whatsappNumber + ' (enabled: ' + pc.whatsappEnabled + ')')
    console.log('  Email: ' + pc.email + ' (enabled: ' + pc.emailEnabled + ')')
    console.log('  SMS: ' + pc.smsEnabled)
    console.log('  WhatsApp provider: ' + (pc.whatsappProvider || 'none'))
  } else {
    console.log('  No phone config found')
  }
  process.exit(0)
}
check().catch(e => { console.error(e); process.exit(1) })
