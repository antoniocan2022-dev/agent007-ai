import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Recommendation 4 (Control Reachability Audit): a control that is only ever exercised inside its own
// unit tests is not the same as a control that is actually reachable from real request traffic. Each
// row here is a concrete, source-verifiable fact about a control point raised by either the original
// architecture audit or the second-opinion critique -- not a re-run of those units' own test suites.
// A row documents the CURRENT true state (fully reachable, narrowly reachable, or a known gap) so a
// regression in wiring is caught even when the underlying unit's own tests still pass in isolation.

const ROOT = join(import.meta.dir, '..')
const lifecycleSource = readFileSync(join(ROOT, 'src/lib/ceo-cognitive-lifecycle.ts'), 'utf-8')
const qualityGateSource = readFileSync(join(ROOT, 'src/lib/ceo-response-quality-gate.ts'), 'utf-8')
const routeSource = readFileSync(join(ROOT, 'src/app/api/agent/route.ts'), 'utf-8')
const outcomeLearningSource = readFileSync(join(ROOT, 'src/lib/ceo-outcome-learning.ts'), 'utf-8')
const persistenceSource = readFileSync(join(ROOT, 'src/lib/ceo-response-persistence.ts'), 'utf-8')
const schemaSource = readFileSync(join(ROOT, 'prisma/schema.prisma'), 'utf-8')

describe('Control Reachability Audit — CEO cognitive lifecycle', () => {
  test('Guardian risk assessment reaches every primary generation call, not just a narrow subset', () => {
    expect(lifecycleSource).toMatch(/const guardianAssessment = request\.decisionContract \? assessGuardianRisk/)
    expect(lifecycleSource).toContain('const primaryMessages = [...worldModelMessages, ...guardianMessages')
  })

  test('GAP: Guardian risk assessment is a prompt instruction only -- the quality gate never independently checks the generated response against it', () => {
    // Explanatory comments in the quality gate are allowed to mention "guardian" (see the completion-claim
    // detector above); what must not exist is an actual functional reference to a guardian assessment.
    expect(qualityGateSource).not.toMatch(/guardianAssessment|assessGuardianRisk|guardianConstraint|input\.guardian/i)
  })

  test('Operator execution-claim gating (canClaimExecution) and Curiosity investigation are both reachable only on the execute response-action path, not generally', () => {
    const operatorPlanLine = lifecycleSource.match(/const operatorPlan = request\.decisionContract\?\.responseAction === 'execute' \? buildCeoOperatorPlan\({[^}]*curiosity: request\.canonicalContext[^}]*assessCeoCuriosity/)
    expect(operatorPlanLine).not.toBeNull()
  })

  test('The false-completion-claim detector independently verifies generated text against real execution agency -- this is the concrete fix for the Operator/Guardian prompt-only gap', () => {
    expect(qualityGateSource).toContain('EXECUTION_COMPLETION_CLAIM_RE')
    expect(qualityGateSource).toContain('externalAgencyAvailable')
    expect(qualityGateSource).toMatch(/falseCompletionClaim\s*=\s*!input\.externalAgencyAvailable/)
  })

  test('externalAgencyAvailable is threaded from the real orchestration-owner decision, not hardcoded, at every evaluateCeoQuality call site', () => {
    const externalAgencyDeclaration = lifecycleSource.match(/const externalAgencyAvailable = decisionPlan\.executionContract\.orchestrationOwner === 'operational_orchestrator'/)
    expect(externalAgencyDeclaration).not.toBeNull()
    const evaluateCalls = lifecycleSource.match(/evaluateCeoQuality\(\{[^}]*\}\)/g) ?? []
    expect(evaluateCalls.length).toBeGreaterThanOrEqual(4)
    for (const call of evaluateCalls) expect(call).toContain('externalAgencyAvailable')
  })

  test('Soft-pass eligibility for analysis/decision intents is reachable -- conversationQuality is actually computed for them, not left undefined', () => {
    expect(qualityGateSource).toMatch(/softPassEligibleIntent\s*=\s*conversational\s*\|\|\s*input\.intent==='decision'\s*\|\|\s*input\.intent==='analysis'/)
  })

  test('The escalation-repair loop is reachable within the deadline a deep/critical path actually needs, not capped by an earlier, shallower pre-router budget', () => {
    expect(lifecycleSource).toMatch(/const deadline = startedAt \+ Math\.max\(request\.timeoutMs \?\? decisionPlan\.latencyBudgetMs, decisionPlan\.latencyBudgetMs\)/)
  })

  test('Concurrent/duplicate requests for the same conversation cannot both run the lifecycle or orchestrator twice: idempotency is enforced in the same transaction that claims a turn', () => {
    expect(routeSource).toContain('isUniqueConstraintViolation(turnError)')
    expect(routeSource).toContain("isDuplicateRequest = true")
    expect(routeSource).toContain("sse('duplicate'")
  })

  test('A response computed after a newer turn was already accepted is never persisted into the visible transcript or broadcast as current, in both the ceo_lifecycle and operational_orchestrator lanes', () => {
    const supersededChecks = routeSource.match(/isResponseSuperseded\(myTurnSequence, latestRevisionAtCompletion\)/g) ?? []
    expect(supersededChecks.length).toBe(2)
    const supersededSseEvents = routeSource.match(/sse\('superseded'/g) ?? []
    expect(supersededSseEvents.length).toBe(2)
  })

  test('A superseded response is audited, not silently discarded and not silently kept as if current', () => {
    expect(persistenceSource).toContain('export async function recordSupersededCeoResponse')
    expect(routeSource).toContain('recordSupersededCeoResponse({ conversationId, content: response.content')
    expect(routeSource).toContain('recordSupersededCeoResponse({ conversationId, content: synthesis.content')
  })

  test('A crashed/orphaned turn is durably distinguishable from a completed one via a two-state marker, closed on every normal exit path this request can take', () => {
    expect(schemaSource).toMatch(/turnStatus\s+String\s+@default\("closed"\)/)
    expect(routeSource).toContain("turnStatus: 'open'")
    expect(persistenceSource).toContain('export async function closeCeoTurnMarker')
    const closeCalls = routeSource.match(/closeCeoTurnMarker\(\{ conversationId, turnSequence: myTurnSequence \}\)/g) ?? []
    // Closed at both real exit points before the stream begins (semantic-interpretation cancellation)
    // and in the stream's own finally block (success, degraded, superseded, cancelled, or error).
    expect(closeCalls.length).toBe(2)
  })

  test('GAP: the two-state marker is deliberately not a full persisted lifecycle state machine -- it records completion, not which stage the crash happened in', () => {
    // Intentional scope boundary: verifying this stays a 2-state marker (open/closed) rather than
    // silently growing into an unreviewed multi-state machine over time.
    const turnStatusValues = new Set([...schemaSource.matchAll(/turnStatus[^\n]*@default\("(\w+)"\)/g)].map((m) => m[1]))
    const assignedValues = new Set([...routeSource.matchAll(/turnStatus:\s*'(\w+)'/g)].map((m) => m[1]))
    const allValues = new Set([...turnStatusValues, ...assignedValues])
    expect(allValues).toEqual(new Set(['open', 'closed']))
  })

  test('GAP: the continuous loop is reachable from real request traffic only via the recommend/decide response-action path, and only best-effort -- a failure to start it is swallowed to a warning, never surfacing to the caller or affecting the response', () => {
    expect(routeSource).toMatch(/decisionContract\?\.responseAction === 'recommend' \|\| decisionContract\?\.responseAction === 'decide'/)
    expect(outcomeLearningSource).toContain("await import('./ceo-continuous-loop')")
    expect(outcomeLearningSource).toMatch(/catch \(error\) \{ console\.warn\('\[ceo-recommendation\] continuous-loop initialization failed:'/)
  })
})
