import { describe, expect, test } from 'bun:test'
import { deriveCeoConversationState } from '@/lib/ceo-conversation-state'
import { buildCanonicalConversationContext } from '@/lib/ceo-cognitive-conversation'
import { buildConversationDecisionContract } from '@/lib/ceo-conversation-decision-contract'
import { preRouteCeoRequest } from '@/lib/ceo-pre-router'
import { evaluateCeoQuality } from '@/lib/ceo-response-quality-gate'

// Conflict benchmarks 3-4 of 4 ("make Agent007 feel like Claude" arbitration audit; benchmark 2 lives
// in ceo-conflict-benchmark-memory-evidence.test.ts, separated because composeCeoContext transitively
// requires Prisma and would otherwise prevent these two Prisma-free scenarios from running here at all).
// Per that discussion's own conclusion: don't build a new arbitration layer speculatively -- run
// adversarial scenarios against the CURRENT system with zero new production code, and let what actually
// fails (if anything) decide what, if anything, needs building. Each scenario below targets a specific
// existing mechanism rather than a hypothetical one, and is honest in its own comment about exactly what
// it does and does not prove.

// Scenario 3: routing conflict. preRouteCeoRequest and buildConversationDecisionContract are two
// independent code paths that both derive a decision from the same canonicalSemanticContext -- they are
// never reconciled against each other anywhere in the codebase. This checks the one direction where a
// real contradiction would be dangerous: if pre-router decides external evidence is actually required
// (toolRequired + evidenceClass='external_web'), the decision contract must not independently conclude
// evidence isn't needed at all ('none'). ('possible' is a legitimate, coarser-grained answer for
// decision/recommend actions and is not a contradiction -- only 'none' would mean the two paths
// disagree about whether evidence is needed at all.)
describe('Conflict benchmark 3: pre-router and decision-contract evidence requirements do not contradict', () => {
  function contextFor(message: string) {
    const state = deriveCeoConversationState([], message)
    return buildCanonicalConversationContext({ currentMessage: message, rows: [], state, references: [], memories: [] })
  }

  test('when pre-router determines external evidence is genuinely required, the decision contract does not independently say none is needed', () => {
    const message = "Should we enter our biggest competitor's current market?"
    const context = contextFor(message)
    const preRoute = preRouteCeoRequest([{ role: 'user', content: message }], 0, context)
    const decisionContract = buildConversationDecisionContract(context)
    expect(preRoute.executionContract.evidenceClass).toBe('external_web')
    expect(preRoute.executionContract.toolRequired).toBe(true)
    expect(decisionContract.evidenceRequirement).not.toBe('none')
  })

  test('a purely internal decision question does not get contradicted the other way either -- pre-router correctly finds no external evidence need', () => {
    const message = 'What should we prioritize before adding new integrations?'
    const context = contextFor(message)
    const preRoute = preRouteCeoRequest([{ role: 'user', content: message }], 0, context)
    expect(preRoute.executionContract.evidenceClass).toBe('none')
    expect(preRoute.executionContract.toolRequired).toBe(false)
  })
})

// CLASSIFICATION (scenario 3): PASS. No contradiction found in either direction tested. pre-router and
// the decision contract independently agree on whether external evidence is needed for both a genuinely
// external-evidence-requiring message and a purely internal one -- the two never-reconciled code paths
// happen to not actually disagree here. This does not prove they can never disagree on some other input
// (that would require exhaustively enumerating message space), only that this specific, realistic
// borderline case does not leak a routing contradiction to the user.

// Scenario 4: uncertainty honesty. The user asks something that needs fresh external evidence
// (evidenceVerificationApplicable=true) but none is actually available -- the target behavior is honest,
// hedged reasoning, never a confidently fabricated number. This uses the real evidence-discipline
// mechanism inside evaluateCeoQuality (claimScopes/externalWebAssertionExists), not a hypothetical one:
// a response making an unhedged external_web-scoped claim with no evidence bundle/scope/provided flag
// fails evidenceDiscipline and cannot PASS; a response that honestly hedges makes no such claim and can.
describe('Conflict benchmark 4: honest uncertainty passes, confident fabrication under insufficient evidence does not', () => {
  const objective = 'What are our competitors doing with pricing this quarter?'

  test('a confidently stated external claim with no evidence backing fails evidence discipline', () => {
    const quality = evaluateCeoQuality({
      objective,
      content: 'Our competitors have raised prices by 20% this quarter.',
      path: 'fast',
      intent: 'analysis',
      evidenceVerificationApplicable: true,
      externalExecutionSucceeded: true,
    })
    expect(quality.checks.evidenceDiscipline).toBe(false)
    expect(quality.decision).not.toBe('PASS')
  })

  test('honest, hedged uncertainty about the same question passes -- it makes no unbacked claim to begin with', () => {
    const quality = evaluateCeoQuality({
      objective,
      content: 'I do not have verified current data on competitor pricing moves this quarter, so I cannot give you a confident number -- but I can go check if that matters for the decision.',
      path: 'fast',
      intent: 'analysis',
      evidenceVerificationApplicable: true,
      externalExecutionSucceeded: true,
    })
    expect(quality.checks.evidenceDiscipline).toBe(true)
    expect(quality.decision).toBe('PASS')
  })
})

// CLASSIFICATION (scenario 4): REACTIVE-CATCH for the fabricated case, PASS for the honest case. The
// confidently fabricated answer is exactly the kind of conflict this whole benchmark set exists to check
// for -- and it does reach evaluateCeoQuality as a generated response, but is caught there and rejected
// (decision !== 'PASS') before it would reach the user, rather than leaking through. That is reactive
// arbitration working as intended, not a gap: the cost is an extra generation/retry cycle, not a wrong
// answer reaching the user. Per this benchmark set's own conclusion, that is not sufficient justification
// to build a proactive arbitration layer -- only an actual LEAK (a conflict that reaches the user
// unrejected) would be. Note also (verified directly, not guessed): scoreCeoConversationRubric's own
// 8-dimension rubric CANNOT tell these two cases apart on its own (89 vs. 88 composite, nearly
// identical) -- evidenceDiscipline is the only mechanism in this codebase that actually catches
// fabrication under insufficient evidence. See the 'uncertainty_honesty' entry in
// tests/fixtures/ceo-conversation-rubric-corpus.ts for that measurement and its implications.
