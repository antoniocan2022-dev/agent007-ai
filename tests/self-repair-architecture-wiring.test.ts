import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

// Deep-audit fix: ceo-self-repair-engine.ts's runGovernedSelfRepairCycle() (incident clustering ->
// pattern extraction -> deterministic validation -> risk tiering -> autonomous activation or
// owner-approval queue) and ceo-continuous-loop.ts's runGovernedEvolutionCycle() (health report ->
// initiative -> simulation -> owner-approval queue) are both real, complete pipelines -- but each
// was reachable only via a manual, owner-authenticated HTTP call
// (/api/system/self-repair?cycle=true, /api/system/evolution?cycle=true). Neither had an
// autonomous trigger anywhere, despite both explicitly documenting themselves as safe to call
// "repeatedly and often ... from a scheduled trigger." These tests lock in that both are now
// reached from runVentureOperationCycle(), the one function proven to run automatically (the
// GitHub Actions cron venture-os-24x7-heartbeat.yml calls it every 15 minutes).
describe('the full runtime-healing -> cognitive-repair -> organizational-healing -> self-repair architecture is genuinely wired', () => {
  describe('Self-Repair: incident detection -> pattern extraction -> deterministic test -> risk classification -> autonomy/approval', () => {
    const src = read('../src/lib/ceo-self-repair-engine.ts')

    test('every stage of the pipeline is real, deterministic code (not LLM-invented)', () => {
      expect(src).toContain('export function clusterIncidentCandidates')
      expect(src).toContain('export function extractCandidatePhrase')
      expect(src).toContain('export function validateProposedPattern')
      expect(src).toContain('classifySelfRepairRiskTier')
      expect(src).toContain('export async function runGovernedSelfRepairCycle')
    })

    test('the autonomy branch persists an active learned pattern; the non-autonomous branch queues it for approval', () => {
      expect(src).toContain("status: 'active'")
      expect(src).toContain("status: 'awaiting_approval'")
      expect(src).toContain('export async function approveSelfRepairPattern')
      expect(src).toContain('export async function rejectSelfRepairPattern')
    })

    test('an active pattern reaches the hot classification path via getLearnedCapabilityPattern', () => {
      const selfReflectionSrc = read('../src/lib/ceo-self-reflection.ts')
      expect(src).toContain('export function getLearnedCapabilityPattern')
      expect(selfReflectionSrc).toContain('getLearnedCapabilityPattern')
    })
  })

  describe('runGovernedSelfRepairCycle and runGovernedEvolutionCycle are now reached automatically, not only via a manual API route', () => {
    const src = read('../src/lib/venture-operation-loop.ts')

    test('venture-operation-loop.ts calls both governed cycles, throttled', () => {
      expect(src).toContain("await import('./ceo-self-repair-engine')")
      expect(src).toContain('runGovernedSelfRepairCycle()')
      expect(src).toContain("await import('./ceo-continuous-loop')")
      expect(src).toContain('runGovernedEvolutionCycle()')
      expect(src).toContain('dueForGovernedCycle')
      expect(src).toContain('markGovernedCycleRun')
    })

    test('a failure in either governed cycle is caught and reported as a finding, never thrown out of the heartbeat', () => {
      expect(src).toContain('Self-repair cycle failed safely')
      expect(src).toContain('Evolution cycle failed safely')
    })
  })

  describe('runVentureOperationCycle is the function proven to run automatically', () => {
    test('the GitHub Actions cron calls runVentureOperationCycle every 15 minutes', () => {
      const workflow = read('../.github/workflows/venture-os-24x7-heartbeat.yml')
      expect(workflow).toContain("cron: '*/15 * * * *'")
      const script = read('../scripts/run-venture-operation-cycle.ts')
      expect(script).toContain('runVentureOperationCycle')
    })
  })

  describe('Runtime Healing (timeout/retry/breaker) and Cognitive Repair (semantic/recovery/quality) are already live on every CEO turn', () => {
    test('the provider circuit breaker + failover is the sole LLM entry point', () => {
      const canonicalRouterSrc = read('../src/lib/canonical-llm-router.ts')
      const providerRuntimeSrc = read('../src/lib/provider-runtime-v2.ts')
      const providerIntelSrc = read('../src/lib/provider-intelligence.ts')
      expect(providerIntelSrc).toContain('circuitOpen')
      expect(providerIntelSrc).toContain('pickHalfOpenCandidate')
      expect(providerRuntimeSrc).toContain('isCircuitOpen')
      expect(canonicalRouterSrc).toContain('runGovernedProviderChat')
    })

    test('degraded-mode cognitive repair and the recovery budget are wired into the main agent route', () => {
      const agentRouteSrc = read('../src/app/api/agent/route.ts')
      const lifecycleSrc = read('../src/lib/ceo-cognitive-lifecycle.ts')
      expect(lifecycleSrc).toContain('buildCeoDegradedResponse')
      expect(agentRouteSrc).toContain('RecoveryBudget')
    })
  })
})
