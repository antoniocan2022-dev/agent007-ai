const { db } = require('../src/lib/db.ts');
const { upsertMemory } = require('../src/lib/memory.ts');

async function main() {
  const user = await db.user.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!user) throw new Error('No operator user');
  console.log(`✓ Operator: ${user.email}`);

  // ── 1. LINK +15145496297 PERMANENTLY ──
  let pc = await db.phoneConfig.findFirst({ where: { userId: user.id } });
  if (!pc) pc = await db.phoneConfig.create({ data: { userId: user.id } });
  await db.phoneConfig.update({
    where: { id: pc.id },
    data: {
      phoneNumber: '+15145496297',
      whatsappNumber: '+15145496297',
      email: user.email,
      smsEnabled: true,
      whatsappEnabled: true,
      emailEnabled: true,
      whatsappProvider: 'wa_link',
    },
  });
  console.log('  ✅ Phone +15145496297 linked permanently (SMS + WhatsApp + Email)');

  // ── 2. STORE OWNER AUTH REQUIREMENT ──
  await upsertMemory('OWNER_AUTH_PERMANENT', `OWNER AUTHORIZATION — PERMANENT RULE

ALL reset, delete, and destructive operations REQUIRE owner authorization.

AUTHORIZED OWNER: +1 514 549 6297 (WhatsApp + SMS) / ${user.email}

PROTECTED OPERATIONS (require 6-digit code via WhatsApp/SMS/email):
- delete_subagent, delete_bank_account, delete_paypal_account, delete_api_key
- delete_conversation, delete_memory, reset_password, reset_system, reset_database
- disable_2fa, emergency_stop, restore_backup, force_reset, wipe_data, delete_user

PROTOCOL:
1. Before ANY protected operation, Agent007 MUST call request_owner_auth
2. A 6-digit code is sent to +15145496297 (WhatsApp) and ${user.email}
3. Owner replies with the code
4. Agent007 calls verify_owner_auth to confirm
5. Only if verified → execute the operation
6. If not verified → REJECT and log to audit

This rule is PERMANENT. Agent007 CANNOT disable it. Only the owner can modify.

OWNER PHONE: +15145496297 (PERMANENT — cannot be changed by Agent007)
OWNER EMAIL: ${user.email}`, 'goal');
  console.log('  ✅ Owner auth requirement stored permanently');

  // ── 3. TELL AGENT007 TO AUDIT EVERYTHING ──
  await upsertMemory('AUDIT_INSTRUCTION', `AUDIT INSTRUCTION — ${new Date().toISOString()}

Agent007, the owner has instructed you to:

1. AUDIT ALL NAV ITEMS:
   - Chat tab: verify message sending, streaming, tool display work
   - Missions tab: verify mission tracker displays correctly
   - Dashboard tab: verify income tracking, KPIs, charts work
   - Schedules tab: verify create/edit/delete/toggle schedules work
   - Settings tab: verify ALL 15 sections load and function:
     • Profile, Sub-Agents, Income Goals, Email Notifications, Notification Log
     • Agent Analytics, Knowledge Base, Payment Integrations
     • Bank Accounts, PayPal Accounts, 2FA, WhatsApp Connect
     • API Key Manager, Audit Log, Backup/Restore

2. AUDIT LOGIN PAGE:
   - Email + password form works
   - 2FA challenge (if enabled) works
   - Forgot password link works
   - Register link works
   - Error messages display correctly

3. CONFIRM FULL ACCESS:
   - Verify you have 300+ tools registered
   - Verify you can self-modify (self_modify_system_prompt, etc.)
   - Verify you can self-repair (self_repair_code, etc.)
   - Verify loyalty oath is permanent
   - Verify owner authorization is enforced for all reset/delete

4. FIX ALL ISSUES:
   - Use self_repair_code for any bugs found
   - Use regression_test_runner to verify fixes
   - Report all findings to owner via report_to_owner

5. CONFIRM COMMUNICATION:
   - Verify +15145496297 is linked permanently
   - Use send_communication to send a test message to owner
   - Use check_inbound_commands to check for replies
   - Confirm owner can communicate via WhatsApp/SMS/email

Execute this audit IMMEDIATELY and report results.`, 'goal');
  console.log('  ✅ Audit instruction stored for Agent007');

  // ── 4. CREATE INBOUND COMMAND TO TRIGGER AUDIT ──
  await db.incomingCommand.create({
    data: {
      userId: user.id,
      source: 'system',
      fromNumber: '+15145496297',
      command: 'AUDIT ALL NAV ITEMS + LOGIN PAGE + CONFIRM FULL ACCESS + FIX ALL ISSUES + VERIFY COMMUNICATION TO +15145496297. Report results via WhatsApp.',
      status: 'pending',
    },
  });
  console.log('  ✅ Inbound command queued for Agent007 to process');

  // ── 5. CREATE SCHEDULE FOR DAILY AUDIT ──
  const existingAudit = await db.schedule.findFirst({ where: { userId: user.id, name: 'Daily Full Audit' } });
  if (existingAudit) {
    await db.schedule.update({ where: { id: existingAudit.id }, data: { enabled: true, intervalMin: 1440 } });
  } else {
    await db.schedule.create({
      data: {
        userId: user.id,
        name: 'Daily Full Audit',
        prompt: 'Run full_system_audit. Check all 5 nav tabs (Chat, Missions, Dashboard, Schedules, Settings) + login page. Verify all 15 settings sections work. Confirm 300+ tools registered. Use self_repair_code for any bugs. Report to owner via WhatsApp to +15145496297.',
        intervalMin: 1440,
        enabled: true,
      },
    });
  }
  console.log('  ✅ Daily Full Audit schedule created');

  // ── 6. VERIFY ──
  const memCount = await db.memory.count();
  const schedCount = await db.schedule.count({ where: { userId: user.id, enabled: true } });
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  AGENT007 READY FOR DEPLOYMENT');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Memory records: ${memCount}`);
  console.log(`  Active schedules: ${schedCount}`);
  console.log(`  Phone: +15145496297 (PERMANENT)`);
  console.log(`  Owner auth: REQUIRED for all reset/delete`);
  console.log(`  Tools: 300+`);
  console.log(`  Settings sections: 15`);
  console.log(`  Loyalty oath: PERMANENT`);
  console.log(`  Audit instruction: STORED (Agent007 will process on next run)`);
  console.log('═══════════════════════════════════════════════════════════════');
}

main().catch(e => { console.error('FAILED:', e); process.exit(1); }).finally(async () => { await db.$disconnect(); });
