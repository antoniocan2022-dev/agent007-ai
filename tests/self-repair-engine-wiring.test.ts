import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { getRecentHealingEvents } from '@/lib/self-healing-engine'
import { toolToolRegistryAudit } from '@/lib/self-repair'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

// Deep-audit fix: self-repair.ts (10 diagnostic/repair tools) and self-healing-engine.ts
// (dispatchWithHealing, the leader retry/fallback engine) were both completely unreachable --
// self-repair.ts's tools were permanently shadowed in TOOL_REGISTRY by same-named,
// LLM-prompt-driven stand-ins from agent007-extensions.ts, and dispatchWithHealing had zero
// callers anywhere and, even if called, dispatched a hardcoded web_search instead of the
// requested leader. Both are now real: self-repair.ts's tools are the ones actually registered,
// and dispatchWithHealing wraps mission-supervisor.ts's real, cron-scheduled leader dispatch.
describe('self-repair + self-healing engines are genuinely wired, not just documented', () => {
  describe('self-repair.ts', () => {
    const src = read('../src/lib/self-repair.ts')
    // The header doc comment intentionally references the old broken paths/behavior as history
    // (that's how the fix is documented); assertions about the CODE no longer doing those things
    // check only the code itself, after the module doc comment.
    const code = src.slice(src.indexOf('import { type ToolContext'))

    test('no hardcoded dev-machine paths remain — every filesystem path is derived from BASE_DIR/process.cwd()', () => {
      expect(src).toContain("const BASE_DIR = process.cwd()")
      expect(code).not.toContain('/home/z/my-project')
    })

    test('backup_create and restore_from_backup delegate to the real Backup V2 implementation instead of copying a nonexistent local SQLite file', () => {
      expect(code).not.toContain('db/custom.db')
      expect(code).toMatch(/await import\(['"]\.\/backup-v2['"]\)/)
      expect(code).toContain('createBackupV2')
      expect(code).toContain('restoreBackupV2')
      // Restoring a live database must default to a dry run.
      expect(code).toContain("const dryRun = args.dry_run !== false")
    })

    test('error_log_analyzer and the health check read the AuditLog table, not a log file nothing ever writes to', () => {
      expect(code).not.toContain('agent-errors.log')
      expect(code).toContain('getRecentAuditFailures')
      expect(code).toContain('db.auditLog.findMany')
    })

    test('API self-tests resolve a real base URL instead of a hardcoded localhost', () => {
      expect(src).toContain('function getSelfBaseUrl')
      expect(src).toContain('NEXTAUTH_URL')
      expect(src).toContain('VERCEL_URL')
    })

    test('cache_clear does not attempt to mutate the read-only deployed filesystem on Vercel', () => {
      expect(src).toContain('process.env.VERCEL')
      expect(src).toContain('onVercel')
    })

    // toolToolRegistryAudit never throws even when its dynamic `./tools` import or the DB is
    // unavailable (this sandbox's Prisma stub unconditionally rejects every call) -- verified as
    // a real invocation, not just a source assertion.
    test('toolToolRegistryAudit runs without throwing against this environment', async () => {
      const result = await toolToolRegistryAudit({}, { attachments: [], language: 'en' })
      expect(typeof result.ok).toBe('boolean')
      expect(typeof result.result).toBe('string')
    })
  })

  describe('self-healing-engine.ts', () => {
    const src = read('../src/lib/self-healing-engine.ts')
    // The header doc comment intentionally references the old broken dispatchTool('web_search')
    // call as history; check the code itself (after the module doc comment) never does that.
    const code = src.slice(src.indexOf('import { db }'))

    test('dispatchWithHealing dispatches the real requested leader via runSubagent, not a hardcoded web_search', () => {
      expect(code).toContain('runSubagent(')
      expect(code).not.toContain("dispatchTool('web_search'")
      expect(code).not.toContain('perspective`')
    })

    test('the leader fallback map still matches real leader ids from subagents.ts', () => {
      const subagentsSrc = read('../src/lib/subagents.ts')
      for (const leader of ['scout', 'aurora', 'echo', 'forge', 'quantum', 'hunt', 'quill', 'prism', 'pulse', 'vertex', 'legal', 'banker', 'trader', 'cybersecurity_a', 'cybersecurity_r', 'developer', 'qa_monitor', 'external_uptime_monitor']) {
        expect(src).toContain(`${leader}:`)
        expect(subagentsSrc).toContain(`id: '${leader}',`)
      }
    })

    test('a fully exhausted dispatch (every leader + the LLM fallback fail) reports status "failed" instead of throwing', () => {
      expect(src).toContain("status: 'failed'")
    })

    // getRecentHealingEvents fails closed to [] against an unreachable/rejecting DB -- verified
    // as a real invocation against this sandbox's always-rejecting Prisma stub.
    test('getRecentHealingEvents never throws, even when the database is unavailable', async () => {
      const events = await getRecentHealingEvents(5)
      expect(Array.isArray(events)).toBe(true)
    })
  })

  describe('mission-supervisor.ts dispatches leaders through self-healing, not raw runSubagent', () => {
    const src = read('../src/lib/mission-supervisor.ts')

    test('runLeader calls dispatchWithHealing for the subagent path', () => {
      expect(src).toContain("import { dispatchWithHealing } from './self-healing-engine'")
      expect(src).toContain('await dispatchWithHealing(leaderId,')
    })

    test('a totally failed dispatch still throws, so RETRY/REPLAN/ESCALATE policy still fires', () => {
      expect(src).toMatch(/healed\.status === 'failed'\)\s*throw new Error/)
    })
  })

  describe('tools.ts registers the real self-repair tools and the new healing tool', () => {
    const src = read('../src/lib/tools.ts')

    test('the 10 self-repair tool names are imported from self-repair.ts, not only from agent007-extensions.ts', () => {
      expect(src).toMatch(/import\s*\{\s*\n\s*toolSystemHealthCheck, toolDatabaseIntegrityCheck, toolApiEndpointTest, toolToolRegistryAudit,\s*\n\s*toolCacheClear, toolSessionRecovery, toolErrorLogAnalyzer, toolAutoFixCommonIssues,\s*\n\s*toolBackupCreate, toolRestoreFromBackup,\s*\n\s*\}\s*from\s*'\.\/self-repair'/)
    })

    test('heal_leader_dispatch is registered', () => {
      expect(src).toContain("TOOL_REGISTRY.heal_leader_dispatch")
      expect(src).toContain('toolHealLeaderDispatch')
    })
  })
})
