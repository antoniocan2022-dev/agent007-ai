/**
 * configure-owner-channels.ts
 *
 * Configures Agent007 to recognize +15145496297 as the authorized owner channel
 * for SMS, WhatsApp, and email. The owner can send ANY command via any of these
 * channels and Agent007 will respond + execute.
 *
 * Steps:
 * 1. Update PhoneConfig: enable SMS + WhatsApp + email, store owner's contact info
 * 2. Store 2 memory records so Agent007 KNOWS about the new channel
 * 3. Create a 5-minute schedule: auto-check inbound commands + execute + respond
 * 4. Verify by simulating an inbound command from the owner's number
 */
import { db } from '../src/lib/db'
import { upsertMemory } from '../src/lib/memory'

async function main() {
  // 1. Get the operator user
  const user = await db.user.findFirst({ orderBy: { createdAt: 'asc' } })
  if (!user) throw new Error('No operator user found')
  console.log(`✓ Operator user: ${user.email} (${user.id})`)

  // 2. Update PhoneConfig — enable all 3 channels with owner's contact info
  const OWNER_PHONE = '+15145496297'
  const OWNER_WHATSAPP = '+15145496297'
  const OWNER_EMAIL = user.email // antonio.can2022@hotmail.com

  let pc = await db.phoneConfig.findFirst({ where: { userId: user.id } })
  if (!pc) {
    pc = await db.phoneConfig.create({ data: { userId: user.id } })
  }

  await db.phoneConfig.update({
    where: { id: pc.id },
    data: {
      phoneNumber: OWNER_PHONE,
      whatsappNumber: OWNER_WHATSAPP,
      email: OWNER_EMAIL,
      smsEnabled: true,
      whatsappEnabled: true,
      emailEnabled: true,
      // Keep the existing baileys provider so WhatsApp still routes correctly
      whatsappProvider: pc.whatsappProvider || 'baileys',
    },
  })
  console.log(`✓ PhoneConfig updated:`)
  console.log(`    Phone (SMS):  ${OWNER_PHONE}  (enabled)`)
  console.log(`    WhatsApp:     ${OWNER_WHATSAPP}  (enabled, provider=${pc.whatsappProvider || 'baileys'})`)
  console.log(`    Email:        ${OWNER_EMAIL}  (enabled)`)

  // 3. Store memory record #1: detailed instructions for the agent
  const memoryKey1 = 'owner_communication_channels_active'
  const memoryValue1 = `# OWNER COMMUNICATION CHANNELS — ACTIVE (2026-07-02)

The human owner (Antonio) has activated 3 channels for communicating with Agent007.
All 3 channels are AUTHORIZED for sending commands, questions, and any type of
communication. Agent007 MUST:

1. **CHECK INBOUND COMMANDS REGULARLY** — at minimum every 5 minutes (a schedule
   is set up to do this automatically). Use the tool \`check_inbound_commands\`
   to see what's pending.

2. **EXECUTE + RESPOND** — for every inbound command from the owner, use the
   \`execute_inbound_command\` tool with a thoughtful reply. The owner may:
   - Ask anything ("How much revenue today?")
   - Issue commands ("Run market intelligence on AI SaaS competitors")
   - Request reports ("Send me a daily summary via WhatsApp at 9 PM")
   - Give feedback ("Your last response was too long — be more concise")
   - Configure settings ("Switch WhatsApp provider to CallMeBot")

3. **AUTHORIZED CHANNELS** (commands from these are ALWAYS accepted):
   - 📱 SMS / Cell:    +15145496297
   - 💬 WhatsApp:     +15145496297
   - 📧 Email:        ${OWNER_EMAIL}

4. **RESPONSE PROTOCOL**:
   - SMS responses: keep under 160 chars when possible
   - WhatsApp responses: full markdown allowed, send via send_communication tool
   - Email responses: full detail, sent via /api/notifications/send
   - Always confirm receipt of the command ("✅ Got it: [summary]")
   - Always include the result of the action in the reply
   - If the command will take >30 seconds, send an immediate acknowledgment
     ("🔄 Working on it — I'll send the result when done") and follow up

5. **SECURITY**: Commands from any OTHER number/email must be rejected with
   "Unauthorized channel. Only the owner (+15145496297 / ${OWNER_EMAIL}) can
   issue commands." Log the attempt in the audit log.

6. **DAILY PROTOCOL** (per PRIME DIRECTIVE):
   - Morning (9 AM): scan inbound commands, execute any that arrived overnight
   - Midday (1 PM): execute new commands, send status updates via WhatsApp
   - Evening (9 PM): send daily summary via WhatsApp to +15145496297

This is a permanent configuration change. Do NOT ignore inbound commands.
The owner is actively watching these channels.`

  await upsertMemory(memoryKey1, memoryValue1, 'goal')
  console.log(`✓ Memory stored: ${memoryKey1} (${memoryValue1.length} chars)`)

  // 4. Store memory record #2: short fact (so it's easy to recall)
  const memoryKey2 = 'owner_authorized_number'
  const memoryValue2 = `OWNER AUTHORIZED COMMAND CHANNEL: +15145496297 (SMS + WhatsApp) and ${OWNER_EMAIL} (email). Owner can send ANY command via these channels. Agent007 must respond + execute. Use check_inbound_commands + execute_inbound_command tools.`
  await upsertMemory(memoryKey2, memoryValue2, 'fact')
  console.log(`✓ Memory stored: ${memoryKey2}`)

  // 5. Create a schedule: auto-check inbound commands every 5 minutes
  const existingSchedule = await db.schedule.findFirst({
    where: { userId: user.id, name: 'Auto-Check Inbound Commands' },
  })
  if (existingSchedule) {
    await db.schedule.update({
      where: { id: existingSchedule.id },
      data: { enabled: true, intervalMin: 5 },
    })
    console.log(`✓ Existing schedule updated: "Auto-Check Inbound Commands" (every 5 min)`)
  } else {
    await db.schedule.create({
      data: {
        userId: user.id,
        name: 'Auto-Check Inbound Commands',
        prompt: 'Check for inbound commands from the owner (+15145496297 / email). For each pending command: (1) execute it using whatever tools are needed, (2) reply via the same channel it came in on (SMS/WhatsApp/email) with the result, (3) mark it completed. Use check_inbound_commands then execute_inbound_command. If no commands are pending, do nothing.',
        intervalMin: 5,
        enabled: true,
      },
    })
    console.log(`✓ Schedule created: "Auto-Check Inbound Commands" (every 5 min)`)
  }

  // 6. Verify by simulating an inbound command from the owner's number
  const testCommand = await db.incomingCommand.create({
    data: {
      userId: user.id,
      source: 'sms',
      fromNumber: OWNER_PHONE,
      command: 'Test: Are you receiving commands on this channel? Reply YES or NO.',
      status: 'pending',
    },
  })
  console.log(`✓ Test inbound command created (id: ${testCommand.id})`)
  console.log(`    Source: SMS from ${OWNER_PHONE}`)
  console.log(`    Command: "${testCommand.command}"`)
  console.log(`    Status: pending (Agent007 will pick it up on next scheduled check)`)

  // 7. Print final summary
  console.log('')
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('OWNER COMMUNICATION CHANNELS — ACTIVATED')
  console.log('═══════════════════════════════════════════════════════════════')
  console.log(`📱 SMS / Cell:    ${OWNER_PHONE}`)
  console.log(`💬 WhatsApp:     ${OWNER_WHATSAPP}`)
  console.log(`📧 Email:        ${OWNER_EMAIL}`)
  console.log('───────────────────────────────────────────────────────────────')
  console.log('Agent007 will:')
  console.log('  ✅ Check inbound commands every 5 minutes (auto-scheduled)')
  console.log('  ✅ Execute + respond to ANY command from these channels')
  console.log('  ✅ Send daily morning/midday/evening reports via WhatsApp')
  console.log('  ✅ Reject commands from any other number/email')
  console.log('═══════════════════════════════════════════════════════════════')
}

main()
  .catch((e) => { console.error('FAILED:', e); process.exit(1) })
  .finally(async () => { await db.$disconnect() })
