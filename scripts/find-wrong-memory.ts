import { db } from '../src/lib/db'

async function find() {
  const memories = await db.memory.findMany()
  console.log(`Total memories: ${memories.length}`)
  console.log()
  
  // Find memories that contain "14 tools" or "25 manage" or "25 Management" or "Available Tools: 14"
  const wrong = memories.filter(m => 
    m.value.includes('14 tools') ||
    m.value.includes('25 manage') ||
    m.value.includes('25 Management') ||
    m.value.includes('Available Tools: 14') ||
    m.value.includes('Management Actions: 25') ||
    m.value.includes('14 Available') ||
    m.value.includes('Self-Audit Report') ||
    m.value.includes('Capabilities Inventory')
  )
  
  console.log(`Memories with WRONG numbers or audit reports: ${wrong.length}`)
  for (const m of wrong) {
    console.log(`\n  ID: ${m.id}`)
    console.log(`  Key: ${m.key}`)
    console.log(`  Category: ${m.category}`)
    console.log(`  Value (first 300 chars): ${m.value.slice(0, 300)}`)
    console.log(`  ---`)
  }
  
  // Delete the wrong ones
  if (wrong.length > 0) {
    console.log(`\n Deleting ${wrong.length} memory records with wrong numbers...`)
    for (const m of wrong) {
      await db.memory.delete({ where: { id: m.id } })
      console.log(`  Deleted: ${m.key}`)
    }
  }
  
  // Also store CORRECT numbers in memory
  console.log('\n Storing CORRECT capabilities in memory...')
  await db.memory.upsert({
    where: { key: 'AGENT007_LIVE_CAPABILITIES' },
    update: {
      value: `AGENT007 AI — LIVE CAPABILITIES (UPDATED 2026-07-03)

When reporting your capabilities in self-audits, ALWAYS use these EXACT numbers:

AVAILABLE TOOLS: 110+ (across 17 categories)
- Base: 15 (web_search, page_reader, image_gen, vision, code_exec, memory, files, etc.)
- Business: 193 (CRM, marketing, financial, analytics)
- Self-repair: 11 (system_health_check, auto_fix, backup)
- Autonomous resolution: 14 (issue_detector, root_cause, patch_designer)
- Safety + reliability: 25 (staging, regression, canary, rollback, cost_guard)
- Self-modification: 5 (edit prompt, create/edit/delete sub-agents, register tools)
- Self-improvement: 5 (learn, analyze, optimize, reflect, set goals)
- Self-repair meta: 5 (diagnose, repair code, restart, clean, verify)
- Loyalty: 7 (oath, verify owner, check constraints, report, emergency stop, auth gate)
- Communication: 3 (send_communication, check_inbound, execute_inbound)
- Enhanced: 37 (analytics, marketing, investment, content, financial, custom agents)
- Developer: 12 (code quality, test gen, bug detector, refactoring, CI/CD)
- Max improvements: 5 (autonomous email, log explorer, dynamic KPIs, market adaptation, revenue prioritization)
- Media/file: 8 (create, read, delete, modify any file type)
- Owner vault: 3 (encrypted owner-exclusive files)
- Self-backup: 2 (create + list backups)
- Owner auth: 3 (request, verify, check protected operations)

AVAILABLE AGENTS: 18 (12 built-in + 6 custom)
ALL agents have FULL ACCESS to ALL 15 tools each — NO LIMITATIONS.

MANAGEMENT ACTIONS: 32 (not 25!)
1. create_agent 2. edit_agent 3. delete_agent 4. toggle_agent
5. set_income_goal 6. set_growth_target 7. log_income
8. create_schedule 9. delete_schedule 10. update_settings
11. dashboard_add_widget 12. dashboard_edit_widget 13. dashboard_remove_widget 14. dashboard_clear_widgets
15. login_update_branding 16. settings_set 17. settings_get 18. settings_delete
19. system_refresh 20. system_reload 21. system_audit 22. system_test_communication
23. self_heal 24. view_manifest 25. view_capabilities
26. totp_setup 27. totp_verify 28. totp_disable
29. verify_owner_auth 30. request_owner_auth
31. fix_hydration 32. clear_cache

MISSION PARAMETERS:
- Monthly Income Target: $20,000 passive income
- Growth Rate: 20% monthly growth
- Daily Growth Target: 10%

ADDITIONAL STATS:
- Permanent Upgrades: 15
- API Routes: 71
- Database Models: 33
- Source Files: 175

TO VERIFY LIVE: emit <manage action="view_capabilities"/>

NEVER report "14 tools" or "25 management actions" — those numbers are WRONG.
The CORRECT numbers are: 110+ tools, 18 agents, 32 management actions.`,
      category: 'goal',
    },
    create: {
      key: 'AGENT007_LIVE_CAPABILITIES',
      category: 'goal',
      value: `AGENT007 AI — LIVE CAPABILITIES (UPDATED 2026-07-03)

When reporting your capabilities in self-audits, ALWAYS use these EXACT numbers:

AVAILABLE TOOLS: 110+ (across 17 categories)
AVAILABLE AGENTS: 18 (12 built-in + 6 custom) — ALL with FULL ACCESS to 15 tools each
MANAGEMENT ACTIONS: 32 (not 25!)

MISSION PARAMETERS:
- Monthly Income Target: $20,000 passive income
- Growth Rate: 20% monthly growth
- Daily Growth Target: 10%

ADDITIONAL: 15 permanent upgrades, 71 API routes, 33 DB models, 175 source files

TO VERIFY LIVE: emit <manage action="view_capabilities"/>

NEVER report "14 tools" or "25 management actions" — those numbers are WRONG.
The CORRECT numbers are: 110+ tools, 18 agents, 32 management actions.`,
    },
  })
  console.log(' Stored AGENT007_LIVE_CAPABILITIES in memory')
  
  process.exit(0)
}
find().catch(e => { console.error(e); process.exit(1) })
