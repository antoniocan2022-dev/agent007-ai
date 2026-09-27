import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

function read(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

// Fresh-audit regression (Stages 0-7): buildCeoDecisionPlan's `critical`/`missionRelevant` gate
// (ceo-cognitive-kernel.ts) computes `input.preRoute.missionRelevant || Boolean(input.missionId)` --
// an explicit mission-execution caller (mission-supervisor.ts's CEO-leader dispatch, the
// mission-active owner-question route) is trusted unconditionally, independent of whether
// preRouteCeoRequest's text classifier happened to read the message content as mission-relevant.
// resolveCeoLane must be called with that same missionId everywhere lane is derived from a
// PreRouteDecision, or a mission-tied turn whose phrasing reads as ordinary conversation gets
// critical=true/qualityTier='critical' from the kernel while a separately-recomputed lane falls
// through to fast_chat, silently downgrading reasoningStrategy or provider selection. Pinned as a
// static-source-text check across both real call sites (resolveCeoLane's own unit tests in
// ceo-cognitive-contract-lane.test.ts and ceo-cognitive-kernel-fast-chat.test.ts already cover the
// pure-function behavior once missionId is passed correctly).
describe('resolveCeoLane call sites stay consistent with missionId', () => {
  test('buildCeoDecisionPlan passes input.missionId into resolveCeoLane', () => {
    const source = read('src/lib/ceo-cognitive-kernel.ts')
    expect(source).toMatch(/resolveCeoLane\(input\.preRoute,\s*input\.missionId\)/)
  })

  test('runCeoCognitiveLifecycle passes request.missionId into its own lane recomputation', () => {
    const source = read('src/lib/ceo-cognitive-lifecycle.ts')
    expect(source).toMatch(/resolveCeoLane\(preRoute,\s*request\.missionId\)/)
  })
})
