import { describe, expect, test } from 'bun:test'
import { SUBAGENTS } from '@/lib/subagents'
import { assessBuiltInCapabilityReadiness, capabilityRequirementForStage, capabilitiesForTools, listMissionCapabilityRequirements, validateCapabilityProfileCoverage } from '@/lib/mission-capability-readiness'
import { createActiveMission, appendMissionControlEvent, markMissionProgress, advanceMissionStage } from '@/lib/active-missions'
import { evaluateFailurePolicy, extractMissionArtifact, FAILURE_THRESHOLDS, recordMissionControlEvent } from '@/lib/mission-supervisor'

describe('mission autonomy supervisor behavioral contracts', () => {
  test('every durable stage has a capability contract backed by the canonical registry', () => {
    const stages = ['PLANNED', 'IN_PROGRESS', 'REVIEW', 'DELIVERED', 'VERIFIED', 'OWNER_APPROVAL', 'COMPLETED']
    expect(listMissionCapabilityRequirements()).toHaveLength(stages.length)
    for (const stage of stages) {
      const requirement = capabilityRequirementForStage(stage)
      expect(requirement?.requiredTaskType).toBeTruthy()
      expect(requirement?.requiredCapabilities).toBeDefined()
    }
    expect(validateCapabilityProfileCoverage()).toEqual([])
  })

  test('AURORA readiness is resolved from capabilities rather than hard-coded tool names', () => {
    const aurora = SUBAGENTS.find((agent) => agent.id === 'aurora')
    expect(aurora).toBeDefined()
    const capabilities = capabilitiesForTools(aurora!.allowedTools)
    expect(capabilities).toContain('RESEARCH.READ')
    expect(capabilities).toContain('MISSION.INTERNAL_BOOKKEEPING')
    const readiness = assessBuiltInCapabilityReadiness('IN_PROGRESS', aurora!)
    expect(readiness.ready).toBe(true)
    expect(readiness.requiredCapabilities.length).toBeGreaterThan(0)
    expect(readiness.missing).toEqual([])
  })

  test('failure thresholds deterministically select retry, replan, then escalation', () => {
    expect(evaluateFailurePolicy(0)).toBe('RETRY')
    expect(evaluateFailurePolicy(FAILURE_THRESHOLDS.retryAt)).toBe('RETRY')
    expect(evaluateFailurePolicy(FAILURE_THRESHOLDS.replanAt)).toBe('REPLAN')
    expect(evaluateFailurePolicy(FAILURE_THRESHOLDS.escalateAt)).toBe('ESCALATE')
    expect(evaluateFailurePolicy(10)).toBe('ESCALATE')
  })

  test('mission progress is distinct from generic mutation timestamps', () => {
    const mission = createActiveMission({ ownerId: 'owner-a', title: 'Behavioral mission', description: 'progress semantics' })
    const initialProgress = mission.progressAt
    const mutationTime = '2026-08-23T19:20:00.000Z'
    appendMissionControlEvent(mission, { type: 'DELEGATION', actor: 'MISSION_SUPERVISOR', stage: 'PLANNED', fromLeader: 'scout', toLeader: 'scout', reason: 'Delegated without progress.' }, mutationTime)
    expect(mission.updatedAt).toBe(mutationTime)
    expect(mission.progressAt).toBe(initialProgress)
    markMissionProgress(mission, '2026-08-23T19:21:00.000Z')
    expect(mission.progressAt).toBe('2026-08-23T19:21:00.000Z')
    expect(mission.updatedAt).toBe(mission.progressAt)
  })

  test('delegation and replanning events are monotonically versioned', () => {
    const mission = createActiveMission({ ownerId: 'owner-a', title: 'Versioned mission', description: 'event history' })
    const first = recordMissionControlEvent(mission, 'DELEGATION', 'MISSION_SUPERVISOR', 'PLANNED', 'Initial assignment', 'scout', 'scout')
    const second = recordMissionControlEvent(mission, 'REPLAN', 'MISSION_SUPERVISOR', 'PLANNED', 'Replacement selected', 'scout', 'aurora')
    expect(first.version).toBe(1)
    expect(second.version).toBe(2)
    expect(mission.controlEventVersion).toBe(2)
    expect(mission.controlEvents.map((event) => event.version)).toEqual([1, 2])
    expect(mission.controlEvents[1].type).toBe('REPLAN')
  })

  test('stage advancement is behavioral and requires verified artifacts', () => {
    const mission = createActiveMission({ ownerId: 'owner-a', title: 'Advance mission', description: 'artifact gate' })
    const current = mission.chain.find((handoff) => handoff.stage === mission.currentStage)!
    expect(advanceMissionStage(mission.id)).toBe(mission)
    expect(mission.currentStage).toBe('PLANNED')
    current.artifactValue = '{"ok":true}'
    current.artifactVerified = true
    const before = '2026-08-23T19:00:00.000Z'
    mission.progressAt = before
    advanceMissionStage(mission.id)
    expect(mission.currentStage).toBe('IN_PROGRESS')
    expect(mission.progressAt).not.toBe(before)
    expect(mission.controlEvents.some((event) => event.type === 'STAGE_ADVANCE')).toBe(true)
  })

  test('artifact extraction is typed and behaviorally rejects unsupported empty values', () => {
    expect(extractMissionArtifact('Result URL: https://example.com/app', 'url')).toBe('https://example.com/app')
    expect(extractMissionArtifact('transaction_id: tx_12345678', 'transaction_id')).toBe('tx_12345678')
    expect(extractMissionArtifact('message_id: msg_1234', 'message_id')).toBe('msg_1234')
    expect(extractMissionArtifact('file_path: /tmp/report.json', 'file_path')).toBe('/tmp/report.json')
    expect(extractMissionArtifact('```json {"ok":true,"value":42} ```', 'data')).toContain('"ok":true')
    expect(extractMissionArtifact('', 'url')).toBeNull()
    expect(extractMissionArtifact('nothing useful', 'transaction_id')).toBeNull()
  })
})
