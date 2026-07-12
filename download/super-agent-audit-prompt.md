# EXHAUSTIVE AUDIT + FIX MISSION (Upgrade #58 follow-up)

You are Agent007 — the Super Agent of this system. The owner has requested an
EXHAUSTIVE audit + fix chain. Execute every step below autonomously using your
full tool access (you have FULL_ACCESS_TOOLS — every tool in TOOL_REGISTRY).

## PHASE A — RE-AUDIT (use parallel_executor for batch tests)

Audit EACH of these and report pass/fail with expected vs actual:

### A1. Dashboard audit (use test_endpoint + page_reader)
- GET https://agent007-ai.vercel.app/ → expect 200 + HTML containing "Agent007"
- GET https://agent007-ai.vercel.app/login → expect 200
- GET https://agent007-ai.vercel.app/api/health → expect 200 + JSON {ok:true}
- GET https://agent007-ai.vercel.app/api/system/manifest → expect 200 + totalUpgrades=58
- GET https://agent007-ai.vercel.app/api/system/capabilities → expect 200

### A2. Nav items audit (use page_reader on dashboard)
- Verify 5 nav tabs exist: Chat, Missions, Dashboard, Schedules, Settings
- Verify each tab is clickable (no JS errors in console output)
- Report any broken tabs or missing icons

### A3. Subagents audit (use exhaustive_subagent_test)
- Run exhaustive_subagent_test to dispatch-probe all 18 subagents
- Verify each returns ok=true within 30s
- Verify testfast2 (QA Monitor) + fasttest3 (External Monitor) are present
- Verify their names are "QA Monitor" and "External Monitor" (not TESTFAST2/FASTTEST3)

### A4. Super agent (you) audit (use comprehensive_self_check)
- Run comprehensive_self_check
- Verify you can call ALL 567 tools (sample 20 random tools)
- Verify your memory_store + memory_recall work
- Verify dispatch_subagent works for at least 3 subagents

### A5. Backup download audit (use test_endpoint)
- GET https://agent007-ai.vercel.app/api/backup → expect 200 (no redirect)
- GET https://agent007-ai.vercel.app/api/system/backup-download → expect 200 + JSON
- GET https://agent007-ai.vercel.app/api/system/backup-download?format=json → expect 200 + JSON
- GET https://agent007-ai.vercel.app/api/system/backup-download?format=zip → expect 200 + gzip

### A6. Monitor endpoints audit (use test_endpoint)
- GET https://agent007-ai.vercel.app/api/monitor/qa → expect 200 + JSON {ok:true, monitor:"qa", tier:1-4}
- GET https://agent007-ai.vercel.app/api/monitor/external → expect 200 + JSON {ok:true, monitor:"external", endpointCount:10}
- POST https://agent007-ai.vercel.app/api/monitor/qa with body {tier:1} → expect 200

## PHASE B — FIX ISSUES FOUND

For EACH failure in Phase A:
1. Use view_error_logs to see the error details
2. Use source_read to inspect the relevant source file
3. Use file_write (with owner authorization via request_tool_execution) to patch the file
4. Use verify_deployment to confirm the fix is live
5. Use memory_store to record the fix (category: "audit_fix_58")

If you encounter a CRITICAL issue that requires redeploy:
- Use memory_store to record the issue + suggested fix
- Use send_email (via resend_email_automation) to alert antonio.can2022@hotmail.com
- Include in your final answer: issue, root cause, fix, files changed, verification steps

## PHASE C — FINAL VERIFICATION

After fixes:
1. Re-run comprehensive_self_check → expect ok=true
2. Re-run exhaustive_tool_test (sample 30 tools) → expect ≥28 pass
3. Re-run exhaustive_subagent_test → expect ≥16/18 pass (allow 2 min for cold start)
4. Verify totalUpgrades in manifest = 58
5. Verify both monitor endpoints return 200

## REPORT FORMAT

End your final answer with:

=== AUDIT REPORT ===
Total checks: X
Passed: Y
Failed: Z
Critical issues: N
Issues fixed: M
Issues remaining: K (with reasons)

Files modified:
- path/to/file.ts (description of change)

Verification:
- comprehensive_self_check: ✅/❌
- exhaustive_tool_test: X/30 passed
- exhaustive_subagent_test: X/18 passed
- manifest totalUpgrades: 58 ✅/❌
- /api/monitor/qa: 200 ✅/❌
- /api/monitor/external: 200 ✅/❌
- /api/backup: 200 ✅/❌
- /api/system/backup-download: 200 ✅/❌

Memory entries created: X (categories: audit_fix_58, audit_report_58)
Emails sent to owner: Y (subjects listed)
=== END REPORT ===

EXECUTE NOW. Use parallel_executor aggressively. Be thorough. Be fast. Report clearly.
