import { describe, expect, test } from 'bun:test'
import { capabilityRequirementForStage, listMissionCapabilityRequirements, validateCapabilityProfileCoverage } from '@/lib/mission-capability-readiness'
import { extractMissionArtifact } from '@/lib/mission-supervisor'
import { readFileSync } from 'node:fs'

describe('mission autonomy supervisor', () => {
  test('defines capability requirements for every durable mission stage', () => {
    const stages = ['PLANNED', 'IN_PROGRESS', 'REVIEW', 'DELIVERED', 'VERIFIED', 'OWNER_APPROVAL', 'COMPLETED']
    for (const stage of stages) {
      const requirement = capabilityRequirementForStage(stage)
      expect(requirement).toBeDefined()
      expect(requirement?.requiredTaskType).toBeTruthy()
      expect(Array.isArray(requirement?.requiredTools)).toBe(true)
    }
    expect(listMissionCapabilityRequirements()).toHaveLength(stages.length)
    expect(validateCapabilityProfileCoverage()).toEqual([])
  })

  test('capability floors match the actual canonical specialist tool definitions', () => {
    const source = readFileSync('src/lib/subagents.ts', 'utf8')
    expect(source).toContain("id: 'aurora'")
    expect(source).not.toMatch(/id: 'aurora'[\s\S]{0,5000}ai_content_factory/)
    expect(source).not.toMatch(/id: 'aurora'[\s\S]{0,5000}'file_write'/)
    expect(capabilityRequirementForStage('IN_PROGRESS')?.requiredTools).toEqual(['web_search', 'page_reader', 'memory_recall'])
  })

  test('scheduler and heartbeat integrate supervisor through the canonical autonomy manager', () => {
    const scheduler = readFileSync('src/app/api/schedules/tick/route.ts', 'utf8')
    const heartbeat = readFileSync('scripts/run-venture-operation-cycle.ts', 'utf8')
    const manager = readFileSync('src/lib/autonomy/autonomy-manager.ts', 'utf8')
    expect(scheduler).toContain("fireDaily('/api/system/mission-supervisor')")
    expect(scheduler).toContain('CRON_SECRET')
    expect(heartbeat).toContain('includeMissionSupervisor: true')
    expect(manager).toContain('MISSION_LEASE_PREFIX')
    expect(manager).toContain('acquireMissionExecutionLease')
    expect(manager).toContain('releaseMissionExecutionLease')
  })

  test('supervisor endpoint is cron-protected and scopes mission inspection by owner', () => {
    const source = readFileSync('src/app/api/system/mission-supervisor/route.ts', 'utf8')
    expect(source).toContain("req.headers.get('authorization')")
    expect(source).toContain('CRON_SECRET')
    expect(source).toContain('ownerId is required for mission inspection')
    expect(source).toContain('getMissionSupervisorSnapshot(body.missionId, body.ownerId.trim())')
    expect(source).toContain('runMissionSupervisorCycle')
  })

  test('supervisor uses durable persistence, per-mission leases, bounded execution, and manager integration', () => {
    const source = readFileSync('src/lib/mission-supervisor.ts', 'utf8')
    expect(source).toContain('acquireMissionExecutionLease')
    expect(source).toContain('releaseMissionExecutionLease')
    expect(source).toContain('runAutonomyManagerTick')
    expect(source).toContain('assumeAutonomyLease')
    expect(source).toContain('executionOwner')
    expect(source).toContain('listActiveMissionsDB')
    expect(source).toContain('saveActiveMissionDB')
    expect(source).toContain('maxLeaderRuns')
    expect(source).toContain('maxMissions')
    expect(source).toContain('REPLAN_REQUIRED')
    expect(source).toContain('REPLAN_AND_CONTINUE')
    expect(source).toContain('WAIT_FOR_ARTIFACT')
    expect(source).toContain('ADVANCE_STAGE')
    expect(source).toContain('OWNER_APPROVAL')
    expect(source).toContain('runCeoCognitiveLifecycle')
    expect(source).toContain('runSubagent')
  })

  test('artifact extraction supports every canonical artifact type', () => {
    expect(extractMissionArtifact('Result URL: https://example.com/app', 'url')).toBe('https://example.com/app')
    expect(extractMissionArtifact('transaction_id: tx_12345678', 'transaction_id')).toBe('tx_12345678')
    expect(extractMissionArtifact('message_id: msg_1234', 'message_id')).toBe('msg_1234')
    expect(extractMissionArtifact('file_path: /tmp/report.json', 'file_path')).toBe('/tmp/report.json')
    const data = extractMissionArtifact('```json {"ok":true,"value":42} ```', 'data')
    expect(data).toContain('"ok":true')
  })

  test('artifact-gated advancement cannot occur without verification', () => {
    const source = readFileSync('src/lib/mission-supervisor.ts', 'utf8')
    expect(source).toContain("h.artifactRequired!=='none'&&(!h.artifactValue||!h.artifactVerified)")
    expect(source).toContain('verifyCanonicalArtifact')
    expect(source).toContain('registerArtifact')
  })

  test('leader output is persisted through the canonical artifact ledger', () => {
    const source = readFileSync('src/lib/mission-supervisor.ts', 'utf8')
    expect(source).toContain('persistLeaderArtifact')
    expect(source).toContain('buildArtifactId')
    expect(source).toContain('registerArtifact')
    expect(source).toContain('h.artifacts.push')
    expect(source).toContain('h.artifactValue = value')
  })

  test('durable missions are owner-bound and cannot use the first-created user', () => {
    const source = readFileSync('src/lib/active-missions-db.ts', 'utf8')
    expect(source).toContain('createActiveMissionDB(input: { ownerId: string;')
    expect(source).toContain('mission.ownerId = ownerId')
    expect(source).not.toContain('findFirst({ orderBy: { createdAt:')
    expect(source).toContain('row.userId')
    const ownerResolver = readFileSync('src/lib/mission-owner.ts', 'utf8')
    expect(ownerResolver).toContain('resolveMissionOwnerId')
    expect(ownerResolver).toContain('db.user.findUnique')
  })

  test('owner approval is a hard boundary and cannot be auto-approved', () => {
    const source = readFileSync('src/lib/mission-supervisor.ts', 'utf8')
    expect(source).toContain("action:'OWNER_APPROVAL'")
    expect(source).toContain('Owner approval is a deliberate governance boundary')
  })
})
