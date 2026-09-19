import { describe, expect, test } from 'bun:test'
import { classifyMissionOutcome } from '@/lib/mission-notifications'

// Phase 3 of the CEO Conversation Kernel migration (making the orchestrator execution-only,
// 2026-09-19): this notification used to live inside orchestrator.ts and fire off the orchestrator's
// own raw narrative before any governance had run. classifyMissionOutcome is the pure decision at its
// core, extracted so it's directly testable without the DB/settings/email side effects around it.
describe('classifyMissionOutcome', () => {
  test('a successful narrative with no tool steps classifies as mission_complete', () => {
    expect(classifyMissionOutcome('The deployment is live and serving traffic.', [])).toBe('mission_complete')
  })

  test('narrative prose starting with an error marker classifies as mission_failed', () => {
    expect(classifyMissionOutcome('⚠️ The deployment failed to complete.', [])).toBe('mission_failed')
    expect(classifyMissionOutcome('Error: could not reach the provider.', [])).toBe('mission_failed')
  })

  // Phase 3 fix: a real tool-step failure now forces mission_failed even when the narrative itself
  // never says so in its first 50 characters -- a governed answer that describes a failure
  // diplomatically ("The WordPress post could not be published this time; retrying next cycle.") used
  // to slip through as mission_complete because none of the literal words error/failed/crashed
  // appeared early enough in the text.
  test('a real failed tool step forces mission_failed even when the narrative reads as calm/diplomatic', () => {
    const diplomaticContent = 'The WordPress post could not be published this time; retrying next cycle.'
    expect(classifyMissionOutcome(diplomaticContent, [{ toolResult: { ok: false } }])).toBe('mission_failed')
  })

  test('all-successful tool steps alongside a clean narrative still classify as mission_complete', () => {
    expect(classifyMissionOutcome('Published the post and notified the team.', [{ toolResult: { ok: true } }, { toolResult: { ok: true } }])).toBe('mission_complete')
  })

  test('a mix of successful and failed tool steps classifies as mission_failed', () => {
    expect(classifyMissionOutcome('Published the post and notified the team.', [{ toolResult: { ok: true } }, { toolResult: { ok: false } }])).toBe('mission_failed')
  })

  test('a step with no toolResult at all does not itself trigger mission_failed', () => {
    expect(classifyMissionOutcome('All good.', [{}])).toBe('mission_complete')
  })
})
