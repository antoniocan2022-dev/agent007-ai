import { describe, expect, test } from 'bun:test'
import { evaluateCeoQuality } from '@/lib/ceo-response-quality-gate'
import { isGovernedSoftPassEligible } from '@/lib/ceo-soft-pass-policy'

describe('P2 quality-gate false positives found via real CI failures', () => {
  test('a short, natural, appropriate greeting reply is not penalized for brevity, including one that ends with a genuine follow-up question', () => {
    const result = evaluateCeoQuality({ objective: 'hi, how do you do?', content: 'Hi! I\u2019m doing well. How are you?', path: 'fast', intent: 'conversation', evidenceVerificationApplicable: false })
    expect(result.decision).toBe('PASS')
  })

  test('a well-structured decision response using a "Decision:" header does not fail specifically for not satisfying the decide action -- confirmed against the exact real CI failure scenario', () => {
    const content = 'Decision: proceed only after independent review and explicit verification of the deployment evidence. The recommended action is to advance the mission only when the evidence package is complete, the identified risks are understood, and the execution conditions are satisfied. Evidence: confirm deployment identity and reconcile the independent review result. Risks: deployment without complete evidence could create an irreversible error. Next actions: complete verification, record the decision, proceed only when gates are satisfied.'
    const result = evaluateCeoQuality({ objective: 'Decide the best mission strategy for Agent007 and explain the evidence, risks, and next actions.', content, path: 'fast', intent: 'decision', responseAction: 'decide', evidenceVerificationApplicable: false })
    expect(result.reasons.join(' ')).not.toContain('did not satisfy the requested response action')
  })

  test('a genuine explanation of risks is not rejected for using ordinary conditional language like "could" -- the exact real CI failure scenario, where a substantive mission-strategy explanation legitimately describing a risk ("could create an irreversible production error") was being blocked as if it were hedging about whether the analysis itself happened', () => {
    const criticalAnswer = '# Recommendation\n\nDecision: proceed only after independent review and explicit verification of the deployment evidence. The recommended action is to advance the mission only when the evidence package is complete, the identified risks are understood, and the execution conditions are satisfied.\n\n## Evidence\n- Confirm the deployment identity and verify the exact release evidence before execution.\n- Confirm the independent review result and reconcile any material disagreement.\n- Preserve the supporting mission evidence so the decision remains auditable.\n\n## Risks\n- Deployment without complete evidence could create an irreversible production error.\n- Conflicting verification results require escalation rather than silent selection.\n- Missing current evidence means the system must not claim live confirmation.\n\n## Next Actions\n1. Complete the independent verification checkpoint.\n2. Record the final evidence and decision state.\n3. Proceed only when all mandatory gates are satisfied.'
    const result = evaluateCeoQuality({ objective: 'Decide the best mission strategy for Agent007 and explain the evidence, risks, and next actions.', content: criticalAnswer, path: 'critical', intent: 'analysis', responseAction: 'explain', evidenceVerificationApplicable: false, reviewed: true })
    expect(result.decision).toBe('PASS')
  })

  test('an ESCALATE-only "analysis" or "decision" response gets a real conversationQuality score, so ceo-soft-pass-policy\'s stated eligibility for these intents (ceo-soft-pass-policy.ts ALLOWED_INTENTS) is actually reachable instead of permanently blocked by an undefined score -- confirmed against the real live-production scenario ("Analyze the psychological patterns...") where escalation never got a chance to soft-pass a substantive answer', () => {
    const objective = 'Analyze the psychological patterns affecting my business decisions.'
    const content = 'Looking at your business decisions, there is a clear psychological pattern: you pull back sharply right after a setback, then swing into oversized bets once your confidence returns, because short-term stress pushes you toward whichever extreme feels safest in the moment. That back-and-forth between caution and overreach tends to produce choices that chase the last outcome instead of the underlying opportunity in front of you.'
    const result = evaluateCeoQuality({ objective, content, path: 'full', intent: 'analysis', responseAction: 'explain', evidenceVerificationApplicable: false })
    expect(result.decision).toBe('ESCALATE')
    expect(result.conversationQuality).toBeDefined()
    expect(result.conversationQuality!.score).toBeGreaterThanOrEqual(75)
    expect(isGovernedSoftPassEligible({ intent: 'analysis', authoritativeIntent: 'analysis', qualityDecision: 'ESCALATE', failureReason: result.failureReason, conversationScore: result.conversationQuality!.score, substantive: true })).toBe(true)

    const decisionResult = evaluateCeoQuality({ objective: 'Should I raise prices or cut costs first?', content: 'Raise prices first: it protects the customers you already trust more than a cost cut would, and it buys you time to fix costs without damaging the product experience while you are doing it.', path: 'full', intent: 'decision', responseAction: 'recommend', evidenceVerificationApplicable: false })
    expect(decisionResult.conversationQuality).toBeDefined()
  })

  test('ordinary citation phrasing ("according to", "studies show") used to explain general, well-established concepts is not treated as an unverifiable external-web claim -- the actual live-production root cause behind the "Analyze the psychological patterns..." incident, where evidenceVerificationApplicable is left to auto-derive (as it always is on the real request path) rather than forced to false as in the test above', () => {
    const objective = 'Analyze the psychological patterns affecting my business decisions.'
    const content = 'According to behavioral research, people who experience a stressful setback tend to overcorrect in the decisions that follow, swinging from excess caution into oversized risk-taking. Studies show that industry consolidation is accelerating, but that broader trend is not what is driving your specific pattern -- your own reactive stress response is.'
    const result = evaluateCeoQuality({ objective, content, path: 'full', intent: 'analysis', responseAction: 'explain' })
    expect(result.claimScopes).not.toContain('external_web')
    expect(result.checks.evidenceDiscipline).toBe(true)
    expect(result.failureReason).not.toBe('evidence_insufficient')
  })

  test('a citation anchored to this business\'s own market/competitive facts still requires live evidence, even when no other pattern in the sentence would have caught it', () => {
    const content = 'Studies show that industry consolidation is accelerating.'
    const result = evaluateCeoQuality({ objective: 'What is happening in our industry?', content, path: 'fast', intent: 'research', externalExecutionSucceeded: true, evidenceProvided: true })
    expect(result.claimScopes).toContain('external_web')
    expect(result.decision).not.toBe('PASS')
    expect(result.checks.evidenceDiscipline).toBe(false)
  })

  // Production incident (2026-09-27): a live "hi" and a live "can you make a self-verification about
  // your system" both burned 25-76 seconds cycling through every provider before falling back to a
  // canned "unverified" refusal. Root-caused against real production logs: the model's own ordinary
  // greeting ("How can I help you today?") was classified as an unverifiable live_system claim purely
  // because it contained the word "today" -- with no evidence bundle ever supplied for a plain greeting,
  // evidenceOk failed permanently, and every escalation attempt reproduced the identical failure since
  // the model kept phrasing its greeting the same ordinary way.
  test('an ordinary greeting using common words like "today"/"current"/"live" is not classified as an unverifiable live-system claim -- the exact real production incident behind a "hi" reply and a self-verification reply both being rejected for lacking fresh evidence', () => {
    const greetings = [
      'Hi! Good to see you. How can I help you today?',
      "Hi! I'm here and ready. What's on your mind today?",
      "Hi! Good to hear from you. I'm currently here and ready to help.",
    ]
    for (const content of greetings) {
      const result = evaluateCeoQuality({ objective: 'hi', content, path: 'fast', intent: 'conversation' })
      expect(result.claimScopes).not.toContain('live_system')
      expect(result.decision).toBe('PASS')
      expect(result.failureReason).not.toBe('evidence_insufficient')
    }
  })

  test('a genuine live-system claim naming actual production/deployment state still requires fresh evidence -- confirms the "today"/"current"/"live" false-positive fix did not also silence real claims', () => {
    const content = 'The current production deployment is verified and serving live traffic.'
    const result = evaluateCeoQuality({ objective: 'Is the system currently live?', content, path: 'fast', intent: 'self_assessment', externalExecutionSucceeded: true })
    expect(result.claimScopes).toContain('live_system')
    expect(result.checks.evidenceDiscipline).toBe(false)
  })

  // Production incident (2026-09-28): "Can you give me updates of 2 stocks: GEOS and MIND Technology.
  // Make me a brief in your own words." got a genuinely good, evidence-backed prose answer -- then
  // structureOk rejected it for having no markdown headings, no bullet list, and no decision-vocabulary
  // word, purely because the user explicitly asked for a plain prose brief rather than a structured
  // report. Root-caused against real production logs (evidenceSourceCount: 56, ESCALATE, then a
  // 123-second chain of failed recovery attempts hitting REQUEST_TOO_LARGE on the growing evidence
  // context) before falling back to a degraded refusal -- self-repair had nothing to repair; the primary
  // answer was already right, the gate's formatting requirement was wrong for what was actually asked.
  test('an explicit "brief in your own words" prose request is not rejected for lacking markdown headings/bullets/decision language -- the exact real production incident behind the GEOS/MIND stock brief failing', () => {
    const objective = 'Can you give me updates of 2 stocks: GEOS and MIND Technology. Make me a brief in your own words.'
    const content = "Geospace Technologies (GEOS) has been navigating a choppy energy-services market, with revenue tied closely to seismic equipment demand from oil and gas exploration. Recent results have shown the company managing costs carefully while waiting for a more durable recovery in offshore and onshore exploration spending. MIND Technology, on the other hand, has been leaning into its marine technology and defense-adjacent products, and has talked about diversifying away from pure oil-and-gas cyclicality. Both are small-cap names, so they tend to swing more on sentiment and order timing than the broader market."
    const result = evaluateCeoQuality({ objective, content, path: 'full', intent: 'research', responseAction: 'answer', reviewed: true, externalExecutionSucceeded: true, evidenceScope: 'external_web', evidenceFreshness: { observedAt: Date.now(), maxAgeMs: 300_000 }, evidenceProvided: true })
    expect(result.checks.actionableStructure).toBe(true)
    expect(result.decision).toBe('PASS')
  })

  test('a request with no explicit prose signal still requires real structure (headings/bullets/decision language) -- confirms the prose-request fix narrows structureOk rather than disabling it', () => {
    const objective = 'Give me a full research report on GEOS and MIND Technology with a recommendation.'
    const content = 'Geospace Technologies has been navigating a choppy energy-services market with revenue tied closely to seismic equipment demand. MIND Technology has been leaning into marine technology and defense-adjacent products to diversify away from oil-and-gas cyclicality. Both are small-cap names that swing more on sentiment than the broader market overall in recent trading sessions this quarter.'
    const result = evaluateCeoQuality({ objective, content, path: 'full', intent: 'research', responseAction: 'answer', reviewed: true, externalExecutionSucceeded: true, evidenceScope: 'external_web', evidenceFreshness: { observedAt: Date.now(), maxAgeMs: 300_000 }, evidenceProvided: true })
    expect(result.checks.actionableStructure).toBe(false)
  })

  test('an explicit prose request on the critical path still requires structure -- the highest-stakes path keeps its structural requirement regardless of phrasing', () => {
    const objective = 'In your own words, give me a brief on this critical decision.'
    const content = 'This is a plain prose answer with no headings, no bullets, and no decision vocabulary words describing the situation in a conversational way without any organizing structure at all for the reader to follow along with easily.'
    const result = evaluateCeoQuality({ objective, content, path: 'critical', intent: 'research', responseAction: 'answer', reviewed: true, externalExecutionSucceeded: true, evidenceScope: 'external_web', evidenceFreshness: { observedAt: Date.now(), maxAgeMs: 300_000 }, evidenceProvided: true })
    expect(result.checks.actionableStructure).toBe(false)
  })
})
