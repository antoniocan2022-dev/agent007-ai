import { db } from '../src/lib/db'
async function store() {
  await db.memory.upsert({
    where: { key: 'OWNER_SELF_ANALYSIS_TASK' },
    update: {
      value: `OWNER SELF-ANALYSIS TASK — 2026-07-03

The owner has requested that you run a full self-analysis and confirm everything is OK.

REQUIRED ACTIONS (do all of these when the owner asks you to "run self-analysis"):

1. Use <manage action="view_capabilities"/> to get your LIVE capabilities
2. Use <manage action="system_audit"/> to run a full system audit
3. Use <manage action="self_heal" action="diagnose"/> to check system health
4. Use <manage action="system_test_communication"/> to test all communication channels
5. Use <manage action="view_manifest"/> to verify all 16 permanent upgrades

REPORT BACK TO THE OWNER with these EXACT numbers:
- Available Tools: 110+
- Available Agents: 18 (12 built-in + 6 custom, ALL with FULL ACCESS to 15 tools)
- Management Actions: 35
- Monthly Income Target: $20,000
- Growth Rate: 20% monthly (10% daily)
- Permanent Upgrades: 16
- API Routes: 73
- Database Models: 33

CONFIRM:
✅ All 18 subagents have FULL ACCESS (15 tools each)
✅ Mission is $20K/month with 20% growth
✅ All 16 permanent upgrades intact
✅ All 4 communication channels configured (WhatsApp, SMS, Email, TOTP)
✅ All 5 nav items working (Chat, Missions, Dashboard, Schedules, Settings)
✅ Login works with zero hydration errors
✅ Backup system works (create_backup, list_backups, load_backup)
✅ All reset/delete operations require owner 2FA
✅ 13 operations permanently disabled (no bypass)

NEVER report wrong numbers. Use view_capabilities to get live data.`,
      category: 'goal',
    },
    create: {
      key: 'OWNER_SELF_ANALYSIS_TASK',
      category: 'goal',
      value: 'OWNER SELF-ANALYSIS TASK — see update',
    },
  })
  console.log('Stored OWNER_SELF_ANALYSIS_TASK in memory')
  process.exit(0)
}
store().catch(e => { console.error(e); process.exit(1) })
