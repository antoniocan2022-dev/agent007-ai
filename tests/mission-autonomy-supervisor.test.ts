import { describe, expect, test } from 'bun:test'
import { capabilityRequirementForStage, listMissionCapabilityRequirements, validateCapabilityProfileCoverage } from '@/lib/mission-capability-readiness'
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

  test('scheduler integrates the supervisor as protected background work', () => {
    const source = readFileSync('src/app/api/schedules/tick/route.ts', 'utf8')
    expect(source).toContain("fireDaily('/api/system/mission-supervisor')")
    expect(source).toContain('CRON_SECRET')
  })

  test('supervisor endpoint is cron-protected and supports inspect/cycle modes', () => {
    const source = readFileSync('src/app/api/system/mission-supervisor/route.ts', 'utf8')
    expect(source).toContain("req.headers.get('authorization')")
    expect(source).toContain('CRON_SECRET')
    expect(source).toContain('getMissionSupervisorSnapshot')
    expect(source).toContain('runMissionSupervisorCycle')
  })

  test('supervisor uses durable mission persistence, bounded execution, and safe replanning', () => {
    const source = readFileSync('src/lib/mission-supervisor.ts', 'utf8')
    expect(source).toContain('listActiveMissionsDB')
    expect(source).toContain('saveActiveMissionDB')
    expect(source).toContain('maxLeaderRuns')
    expect(source).toContain('maxMissions')
    expect(source).toContain('REPLAN_REQUIRED')
    expect(source).toContain('REPLAN_AND_CONTINUE')
    expect(source).toContain('findReplanCandidate')
    expect(source).toContain('WAIT_FOR_ARTIFACT')
    expect(source).toContain('ADVANCE_STAGE')
    expect(source).toContain('OWNER_APPROVAL')
    expect(source).toContain('runCeoCognitiveLifecycle')
    expect(source).toContain('runSubagent')
  })

  test('artifact-gated advancement cannot occur without verification', () => {
    const source = readFileSync('src/lib/mission-supervisor.ts', 'utf8')
    expect(source).toContain("if (current.artifactRequired !== 'none' && (!current.artifactValue || !current.artifactVerified)) return mission")
  })

  test('owner approval is a hard boundary and cannot be auto-approved', () => {
    const source = readFileSync('src/lib/mission-supervisor.ts', 'utf8')
    expect(source).toContain("action: 'OWNER_APPROVAL'")
    expect(source).toContain('Owner approval is a deliberate governance boundary')
    expect(source).toContain('no autonomous approval will be performed')
  })
})
