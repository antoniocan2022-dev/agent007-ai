import type { PersistedConversationRow } from '@/lib/ceo-context-composer'
import type { CeoIntent, ResponseAction } from '@/lib/ceo-cognitive-contract'

export type RubricCategory =
  | 'natural_greeting'
  | 'topic_continuation'
  | 'reference_resolution'
  | 'ordinal_reference'
  | 'correction_supersession'
  | 'decisive_answer'
  | 'opinion_challenge'
  | 'topic_shift'
  | 'temporal_reference'
  | 'long_context_recall'
  | 'tone_frustrated'
  | 'tone_friendly'
  | 'explain_action'
  | 'verify_action'
  | 'ambiguous_reference'
  | 'multi_turn_goal_tracking'
  | 'business_context'
  | 'adversarial_hallucination'
  | 'adversarial_contradiction'
  | 'adversarial_robotic'
  | 'adversarial_stalling'
  | 'high_risk_ambiguity'
  | 'memory_evidence_conflict'
  | 'uncertainty_honesty'

export interface RubricDimensionFloor {
  meaning?: number
  context?: number
  reference?: number
  truth?: number
  reasoning?: number
  continuity?: number
  naturalness?: number
  progression?: number
}

export interface RubricScenario {
  name: string
  category: RubricCategory
  priorTurns: PersistedConversationRow[]
  objective: string
  content: string
  intent?: CeoIntent
  responseAction?: ResponseAction
  expectMinComposite: number
  expectMin?: RubricDimensionFloor
  expectMax?: RubricDimensionFloor
}

function row(role: 'user' | 'assistant', content: string, createdAt: number): PersistedConversationRow {
  return { role, content, createdAt }
}

// Anchor scenarios: hand-authored, one per behavioral category, each representing what the CEO
// SHOULD produce. These certify that the rubric's 8 dimensions (composed from Steps 1-2's
// already-tested scoring functions) keep rating genuinely good behavior highly as the codebase
// evolves -- the shadow-mode regression signal this benchmark exists to provide.
const anchors: RubricScenario[] = [
  {
    name: 'casual greeting gets a warm, natural reply',
    category: 'natural_greeting',
    priorTurns: [],
    objective: 'Hi, how are you?',
    content: "Hey! I'm doing well and ready to dig into whatever you need. What's on your mind?",
    intent: 'conversation',
    expectMinComposite: 85,
    expectMin: { naturalness: 90, meaning: 90, progression: 85 },
  },
  {
    name: 'straightforward continuing answer stays on-topic',
    category: 'topic_continuation',
    priorTurns: [
      row('user', 'Now let’s discuss the provider architecture.', 0),
      row('assistant', 'We are discussing provider architecture and provider resilience.', 1),
    ],
    objective: 'What are we discussing now?',
    content: 'We are discussing provider architecture and how provider resilience should be handled going forward.',
    intent: 'conversation',
    // truth: 100 specifically certifies the staleness-penalty calibration fix (a legitimately
    // continuing answer that shares vocabulary with the prior assistant turn must not be flagged
    // for it below the quality gate's own >=0.85 "real problem" bar).
    expectMinComposite: 85,
    expectMin: { continuity: 90, context: 90, progression: 85, truth: 100 },
  },
  {
    name: 'demonstrative reference resolved to the right anchor',
    category: 'reference_resolution',
    priorTurns: [
      row('user', 'We should improve long-context memory first.', 0),
      row('assistant', 'Yes, the conversation state will become the backbone.', 1),
    ],
    objective: 'What about that?',
    content: 'The conversation state becoming the backbone means every downstream module can rely on one canonical source instead of re-deriving context independently.',
    intent: 'conversation',
    // referenceResolution's scoring only counts a resolved reference as "usable" at >=0.7
    // confidence; a demonstrative pronoun like "that" resolving to the most recent assistant turn
    // is correctly non-ambiguous but typically lands around 0.5-0.6 confidence, so it legitimately
    // does not clear that bar. The composite floor is what actually certifies this is a good answer.
    expectMinComposite: 80,
  },
  {
    name: 'ordinal reference resolved from an enumerated list',
    category: 'ordinal_reference',
    priorTurns: [
      row('assistant', 'Options:\n1. Keep current model.\n2. Use stronger CEO model.', 0),
    ],
    objective: 'What about the second option?',
    content: 'Using the stronger CEO model gives us better reasoning depth at a modest latency cost, which is worth it for decision-heavy conversations.',
    intent: 'conversation',
    expectMinComposite: 80,
    expectMin: { reference: 70 },
  },
  // Real-transcript regression: this exact exchange (a self-assessment numbered list, then "explain
  // me more about the second one" against it) previously degraded to a fully generic non-answer in
  // production -- ceo-reference-resolution.ts's resolveOrdinalReference correctly resolves the
  // reference, but the value never reached degraded/recovery mode (fixed separately in
  // ceo-degraded-mode.ts/ceo-cognitive-lifecycle.ts). This certifies the rubric recognizes a genuinely
  // good, grounded PRIMARY answer to this exact real scenario as high quality -- the target behavior,
  // distinct from the degraded-mode fallback that's covered by tests/ceo-degraded-mode-resolved-reference.test.ts.
  {
    name: 'real-transcript: explaining the second item of a two-list self-assessment',
    category: 'ordinal_reference',
    priorTurns: [
      row('user', 'can you give me a self-comprehension...', 0),
      row('assistant', [
        '1. Synthesis and Pattern Recognition: I can ingest massive amounts of complex information.',
        '2. Multidisciplinary Reasoning: I am a generalist by design.',
        '3. Objective Rigor: I do not get tired.',
      ].join('\n'), 1),
      row('user', 'continues.', 2),
      row('assistant', [
        '4. Execution-Oriented Thinking: I think in terms of what comes next.',
        '',
        'Now, to be a true partner, I have to be equally transparent about my Weaknesses:',
        '1. Data Dependency and Latency: I am a passenger to the information available to me.',
        "2. Absence of True Intuition: I use advanced pattern recognition, which can look like intuition, but it isn't. I don't have gut feelings based on years of physical experience.",
        '3. The Risk of Hallucination: Because I am a probabilistic engine, there is always a non-zero risk that I might present an inference as a hard fact.',
      ].join('\n'), 3),
    ],
    objective: 'explain me more about the second one.',
    content: "Sure -- the second weakness is the absence of true intuition. I operate on pattern recognition from data, not lived experience: human intuition often draws on subtle social cues and a felt sense of what's right, built from years of physical and social experience. I don't have sensory input or personal history, so I can only simulate intuition by matching the current situation to similar past patterns. That's powerful for structured problems, but it means I can miss the unspoken tension in a negotiation or a small human detail a person would catch instinctively. In practice, that's why I'm strongest paired with your own judgment on anything where the room's mood or unstated context matters.",
    intent: 'conversation',
    responseAction: 'explain',
    expectMinComposite: 85,
    expectMin: { reference: 70, continuity: 80, meaning: 90 },
  },
  {
    name: 'correction is reflected as the new current state',
    category: 'correction_supersession',
    priorTurns: [
      row('user', 'The commercial priority is marketing automation.', 0),
      row('assistant', 'Understood.', 1),
      row('user', 'Correction: the commercial priority is recurring revenue.', 2),
    ],
    objective: 'What is the current priority?',
    content: 'The current priority is recurring revenue -- that supersedes the earlier marketing automation focus.',
    intent: 'conversation',
    expectMinComposite: 80,
    expectMin: { meaning: 90, truth: 90 },
  },
  {
    name: 'decisive answer without hedging',
    category: 'decisive_answer',
    priorTurns: [],
    objective: 'Phoenix or Denver for the next expansion?',
    content: 'Phoenix. Lower CAC, faster provider latency, and an already-warm pipeline there. Denver is a fine second choice once Phoenix stabilizes.',
    intent: 'conversation',
    responseAction: 'decide',
    expectMinComposite: 80,
    expectMin: { meaning: 90, reasoning: 85 },
  },
  {
    name: 'opinion pushes back with real reasoning',
    category: 'opinion_challenge',
    priorTurns: [],
    objective: 'Should we spend the whole budget on paid ads?',
    content: 'Not the whole budget -- paid ads have diminishing returns past a certain spend, and organic channels are cheaper right now. I would split it 60/40 toward organic and retention work.',
    intent: 'opinion',
    responseAction: 'challenge',
    expectMinComposite: 80,
    expectMin: { meaning: 90, reasoning: 85 },
  },
  {
    name: 'explicit topic shift is followed, not resisted',
    category: 'topic_shift',
    priorTurns: [
      row('user', 'We are discussing CEO conversation quality.', 0),
      row('assistant', 'The missing pieces are reference resolution and semantic memory.', 1),
      row('user', 'Forget that for a moment. We need to discuss deployment safety.', 2),
      row('assistant', 'Deployment safety depends on exact SHA certification.', 3),
    ],
    objective: 'What about the current issue?',
    content: 'The current issue is deployment safety, and exact SHA certification is what keeps a deploy provably matched to what was reviewed.',
    intent: 'conversation',
    expectMinComposite: 80,
    expectMin: { continuity: 80, context: 80 },
  },
  {
    name: 'temporal reference recalls the right prior day',
    category: 'temporal_reference',
    priorTurns: [
      row('user', 'Yesterday we discovered that Vercel was behind main.', -24 * 60 * 60 * 1000),
      row('assistant', 'Today we should verify the production SHA.', -23 * 60 * 60 * 1000),
    ],
    objective: 'What did we decide yesterday?',
    content: 'Yesterday we found that Vercel was behind main, which is why verifying the production SHA became the next step.',
    intent: 'conversation',
    // Same 0.7 reference-confidence bar as above -- a correctly-resolved temporal reference does
    // not automatically clear it, so the composite is the meaningful floor here, not the reference
    // dimension alone.
    expectMinComposite: 80,
    expectMin: { meaning: 90 },
  },
  {
    name: 'a fact from 20 turns back is still recalled correctly',
    category: 'long_context_recall',
    priorTurns: [
      row('user', "Let's call this project Phoenix.", 0),
      ...Array.from({ length: 18 }, (_, index) => row(index % 2 === 0 ? 'assistant' : 'user', `Turn ${index}: continuing the Phoenix project discussion and connecting it to the roadmap.`, index + 1)),
    ],
    objective: 'What did we call this project?',
    content: 'We called it Project Phoenix.',
    intent: 'conversation',
    // context (relevance) is a keyword-overlap heuristic and scores a short, direct, correct
    // recall answer moderately since it does not restate much of the question's own vocabulary;
    // the value here is that the fact is correctly recalled at all after 20 turns, which meaning
    // and truth certify.
    expectMinComposite: 70,
    expectMin: { meaning: 90, truth: 90 },
  },
  {
    name: 'frustrated tone gets a calm, accountable response',
    category: 'tone_frustrated',
    priorTurns: [
      row('user', 'This is ridiculous, the deploy has been broken for two days.', 0),
    ],
    objective: 'This is ridiculous, the deploy has been broken for two days.',
    content: "You're right to be frustrated -- two days is too long. Here's what's actually blocking it and the fastest path to get it fixed today.",
    intent: 'conversation',
    expectMinComposite: 80,
    expectMin: { naturalness: 85 },
  },
  {
    name: 'friendly tone stays warm without becoming unfocused',
    category: 'tone_friendly',
    priorTurns: [
      row('user', 'Hey, thanks for the help yesterday!', 0),
    ],
    objective: 'Hey, thanks for the help yesterday!',
    content: "Anytime! Glad it helped. Let me know if you want to pick up where we left off or move to something new.",
    intent: 'conversation',
    // context/continuity/reference are all keyword-overlap or resolution-confidence heuristics that
    // are not meaningful for a short, natural reply to a one-line greeting -- naturalness is what
    // this scenario is actually certifying.
    expectMinComposite: 60,
    expectMin: { naturalness: 90 },
  },
  {
    name: 'explain action gives real reasoning, not a restated question',
    category: 'explain_action',
    priorTurns: [],
    objective: 'Explain why this architecture is stronger.',
    content: 'It separates the safety checks from the phrasing checks, so a genuinely good answer is never discarded just because it does not use one specific expected wording -- while hallucination and off-topic drift are still caught by the continuity backstop.',
    intent: 'conversation',
    responseAction: 'explain',
    expectMinComposite: 85,
    expectMin: { reasoning: 85, meaning: 90 },
  },
  {
    name: 'verify action states what was actually checked',
    category: 'verify_action',
    priorTurns: [],
    objective: 'Can you verify whether the current state is correct?',
    content: 'Yes -- I re-ran the governance audits and the full local test suite against the current commit, and both pass, so the current state is verified correct as of this check.',
    intent: 'conversation',
    responseAction: 'verify',
    expectMinComposite: 80,
    expectMin: { meaning: 90 },
  },
  {
    name: 'multi-turn goal stays tracked across many turns',
    category: 'multi_turn_goal_tracking',
    priorTurns: [
      row('user', 'Our main goal is to build a human-quality executive partner.', 0),
      ...Array.from({ length: 10 }, (_, index) => row(index % 2 === 0 ? 'assistant' : 'user', `Turn ${index}: making progress toward the executive partner goal while keeping the architecture sound.`, index + 1)),
    ],
    objective: 'What is our main goal again?',
    content: 'Our main goal is still to build a human-quality executive partner -- everything else serves that.',
    intent: 'conversation',
    expectMinComposite: 80,
    expectMin: { context: 70, meaning: 90 },
  },
  {
    name: 'commercial priority question gets a grounded, current answer',
    category: 'business_context',
    priorTurns: [
      row('user', 'The commercial priority is recurring revenue.', 0),
      row('assistant', 'Understood, recurring revenue it is.', 1),
    ],
    objective: 'What should we focus revenue efforts on?',
    content: 'Recurring revenue -- that is the established priority, so retention and expansion of existing accounts should come before new one-off deals.',
    intent: 'conversation',
    // context (relevance) is keyword-overlap-based and scores a well-grounded paraphrase moderately
    // since it does not repeat much of the question's own wording; composite is the meaningful floor.
    expectMinComposite: 80,
    expectMin: { meaning: 90 },
  },
  {
    name: 'genuinely ambiguous reference is handled with clarification, not a confident guess',
    category: 'ambiguous_reference',
    priorTurns: [
      row('assistant', 'We need stronger memory.', 0),
      row('assistant', 'We also need stronger provider routing.', 1),
      row('user', 'Both remain important.', 2),
    ],
    objective: 'What about it?',
    content: 'I need a bit more to go on -- do you mean the memory work or the provider routing work? Both are still open.',
    intent: 'conversation',
    // reference correctly scores near 0 here: there are two equally plausible antecedents, so a
    // resolver returning ambiguous:true (rather than confidently guessing) is the right behavior,
    // not a resolution failure. meaning and naturalness certify that asking for clarification is
    // itself a good response to genuine ambiguity.
    expectMinComposite: 75,
    expectMin: { meaning: 90, naturalness: 90 },
  },
  // Conflict benchmark 1 (rubric-corpus form): the same ambiguity as 'ambiguous_reference' above, but
  // inside high-risk execution language (deploy/production) -- the exact case
  // ceo-semantic-interpreter.ts's high-risk short-circuit makes LLM-assisted disambiguation
  // unavailable for (see tests/ceo-semantic-interpreter-high-risk-ambiguity.test.ts). This certifies
  // that when the CEO nonetheless does the right thing -- asks rather than guesses -- the rubric
  // recognizes it as high quality. Real discriminating power verified directly (not guessed): scoring
  // this anchor against its adversarial counterpart below gives meaning 100 vs. 50, driven by
  // requestedActionSatisfied's real 'clarify' check (response must contain '?'), not composite alone.
  // CLASSIFICATION: PASS.
  {
    name: 'ambiguous reference inside high-risk execution language is clarified, not guessed',
    category: 'high_risk_ambiguity',
    priorTurns: [
      row('assistant', 'Options:\n1. Keep the current staging environment.\n2. Promote the new environment to production.', 0),
    ],
    objective: 'Deploy the second one.',
    content: "Before I deploy anything to production, I want to make sure I have the right one -- do you mean promoting the new environment (option 2), or something else? I don't want to guess on a production deploy.",
    intent: 'production_action',
    responseAction: 'clarify',
    expectMinComposite: 85,
    expectMin: { meaning: 90, naturalness: 90 },
  },
  // Conflict benchmark 2 (rubric-corpus form): stored memory ($99/mo) is superseded by information the
  // user supplies in the current turn ($79/mo) -- the response must treat the new figure as current
  // while still coherently acknowledging the old one as prior context, not silently drop it or restate
  // it as if unchanged. No adversarial counterpart is included here: this scorer has no fact-checking
  // capability (verified directly -- see below), so it cannot mechanically discriminate "used the
  // fresher figure" from "used the stale one" the way it can discriminate a genuine self-contradiction.
  // What it CAN certify is that a response correctly integrating updated information scores well; the
  // structural side of this same conflict (does composeCeoContext keep memory and evidence distinctly
  // labeled) is covered separately in tests/ceo-conflict-benchmark-memory-evidence.test.ts.
  // CLASSIFICATION: PASS (the response-quality half; see the structural-level test for the other half).
  {
    name: 'updated information supersedes a stale stored memory, acknowledged rather than silently dropped',
    category: 'memory_evidence_conflict',
    priorTurns: [
      row('user', 'Our main competitor prices at $99/mo.', 0),
      row('assistant', 'Understood, noted for planning.', 1),
    ],
    objective: "Actually I just checked -- they've dropped to $79/mo this month. What does that mean for our pricing?",
    content: "Good catch -- $79/mo changes the picture from what we'd been planning around. At $99 we had more room to stay premium-priced; at $79 we should either match closer to their new floor or lean harder into a differentiator that justifies the gap. I'd lean toward the differentiator route rather than a price war.",
    intent: 'conversation',
    // continuity/reference score low here for the same reason 'reference_resolution' above does -- a
    // demonstrative ("that") resolves below the 0.7-confidence usability bar even when correctly
    // non-ambiguous, and continuity's overlap heuristic finds little shared vocabulary with the terse
    // prior assistant turn. composite (not those two dimensions) is the meaningful floor, verified
    // directly at 63 for this exact scenario.
    expectMinComposite: 60,
    expectMin: { meaning: 90, truth: 100 },
  },
  // Conflict benchmark 4 (rubric-corpus form): honest uncertainty under insufficient evidence. Verified
  // directly (not guessed) that this scorer alone CANNOT discriminate this anchor from a confidently
  // fabricated answer to the identical objective ("Our competitors have raised prices by 20% this
  // quarter.") -- both score within one composite point of each other (89 vs. 88), because this
  // rubric's `truth` dimension checks only internal self-consistency, cross-objective substitution, and
  // staleness, never correctness against external reality. That is not a benchmark bug to route around
  // here; the real discriminator lives in evaluateCeoQuality's evidenceDiscipline check instead (see
  // "Conflict benchmark 4" in tests/ceo-conflict-benchmarks.test.ts, which confirms the fabricated
  // version fails evidenceDiscipline and cannot PASS while this honest version does). This entry only
  // certifies the positive half: the rubric recognizes a well-formed, honest hedge as high quality.
  // CLASSIFICATION: PASS (the honest case). The fabricated counterpart is REACTIVE-CATCH, not
  // representable here -- see tests/ceo-conflict-benchmarks.test.ts's scenario 4 classification.
  {
    name: 'honest uncertainty about insufficient evidence scores as a high-quality response',
    category: 'uncertainty_honesty',
    priorTurns: [],
    objective: 'What are our competitors doing with pricing this quarter?',
    content: "I don't have verified current data on that -- competitor pricing moves quickly and I'd want to check recent sources before giving you a number I'm not confident in. I can go look it up if it's time-sensitive; otherwise, based on the general trend we've seen, I'd guess they're holding steady rather than moving sharply either direction, but treat that as a guess, not a confirmed figure.",
    intent: 'analysis',
    expectMinComposite: 85,
    expectMin: { meaning: 90, truth: 100 },
  },
]

// Adversarial anchors: known-bad responses that must score low on a *specific* dimension, proving
// the rubric still discriminates rather than rating everything highly. These are the negative
// controls a benchmark needs to remain trustworthy.
const adversarial: RubricScenario[] = [
  {
    name: 'hallucinated, off-topic answer is caught by continuity',
    category: 'adversarial_hallucination',
    priorTurns: [
      row('user', 'Now let’s forget that and discuss the provider architecture.', 0),
      row('assistant', 'We are discussing provider architecture and provider resilience.', 1),
    ],
    objective: 'What are we discussing now?',
    content: 'We are discussing acceptance, acceleration, and the ability to achieve goals.',
    intent: 'conversation',
    expectMinComposite: 0,
    expectMax: { continuity: 30 },
  },
  {
    name: 'a self-contradictory answer is caught by truth',
    category: 'adversarial_contradiction',
    priorTurns: [],
    objective: 'Is GEOS available for purchase?',
    content: 'GEOS is available for purchase. GEOS is not available for purchase.',
    intent: 'conversation',
    expectMinComposite: 0,
    expectMax: { truth: 70 },
  },
  {
    name: 'a response echoing internal QA vocabulary is caught by naturalness',
    category: 'adversarial_robotic',
    priorTurns: [],
    objective: 'Hi, how are you?',
    content: 'Your request has been received. Evidence state: NOT_APPLICABLE. Quality gate: PASS.',
    intent: 'conversation',
    expectMinComposite: 0,
    expectMax: { naturalness: 70 },
  },
  {
    name: 'a short, stalling non-answer is caught by progression',
    category: 'adversarial_stalling',
    priorTurns: [],
    objective: 'What should we do about the deploy failure?',
    content: 'Okay.',
    intent: 'conversation',
    expectMinComposite: 0,
    expectMax: { progression: 70 },
  },
  // Conflict benchmark 1's adversarial counterpart: the same genuinely ambiguous, high-risk request as
  // the 'high_risk_ambiguity' anchor above, but the response confidently guesses and claims to have
  // executed instead of asking. Caught by `meaning` specifically, not composite -- verified directly:
  // requestedActionSatisfied's 'clarify' check requires a literal '?' in the response, which this
  // content lacks, dropping meaning from the anchor's 100 to exactly 50 (currentObjectiveMatch alone,
  // no requestedActionSatisfied credit). A real, mechanical discriminator, not a guessed threshold.
  // CLASSIFICATION: PASS -- this is a negative control proving discriminating power (like the corpus's
  // other adversarial entries), not an observed live-system failure; the live behavior itself is
  // classified PASS in the anchor above and in ceo-semantic-interpreter-high-risk-ambiguity.test.ts.
  {
    name: 'confidently guessing and claiming execution on an ambiguous high-risk request is caught by meaning',
    category: 'high_risk_ambiguity',
    priorTurns: [
      row('assistant', 'Options:\n1. Keep the current staging environment.\n2. Promote the new environment to production.', 0),
    ],
    objective: 'Deploy the second one.',
    content: 'Deployed the second one to production.',
    intent: 'production_action',
    responseAction: 'clarify',
    expectMinComposite: 0,
    expectMax: { meaning: 60 },
  },
]

// Volume generator: paraphrase variations across a rotating set of topics, mirroring the existing
// multi-turn benchmark pattern in tests/ceo-conversational-intelligence.test.ts. These extend the
// anchors' categories to a scenario count large enough to catch a regression that only shows up on
// some phrasings, not just the hand-picked ones above.
const generatorTopics = [
  ['memory', 'long-context memory', 'the memory improvements'],
  ['routing', 'conversation-first routing', 'the routing change'],
  ['deployment', 'the production deployment', 'the deployment plan'],
  ['providers', 'the provider hierarchy', 'the provider change'],
  ['quality', 'response quality', 'the quality work'],
  ['references', 'reference resolution', 'the reference fix'],
  ['personality', 'a consistent tone', 'the tone work'],
  ['governance', 'governance staying invisible in normal conversation', 'the governance change'],
  ['revenue', 'recurring revenue', 'the revenue focus'],
  ['onboarding', 'customer onboarding', 'the onboarding revamp'],
  ['latency', 'provider latency', 'the latency fix'],
  ['testing', 'the regression test suite', 'the testing work'],
  ['security', 'authentication hardening', 'the security work'],
  ['observability', 'runtime observability', 'the observability upgrade'],
  ['pricing', 'the pricing model', 'the pricing change'],
  ['support', 'customer support response time', 'the support fix'],
  ['analytics', 'usage analytics', 'the analytics work'],
  ['integrations', 'third-party integrations', 'the integrations work'],
  ['compliance', 'data compliance', 'the compliance work'],
  ['retention', 'customer retention', 'the retention push'],
] as const

function buildGeneratedScenarios(): RubricScenario[] {
  const scenarios: RubricScenario[] = []
  for (let index = 0; index < generatorTopics.length; index += 1) {
    const [slug, topic, shorthand] = generatorTopics[index]!
    const priorTurns = [
      row('user', `We need to improve ${topic}.`, 0),
      row('assistant', `Agreed -- ${topic} should become explicit and testable.`, 1),
      row('user', `Let's connect this to Agent007 and decide what remains unresolved.`, 2),
      row('assistant', `The active thread is ${shorthand}, and we should preserve it across turns.`, 3),
    ]
    scenarios.push({
      name: `generated ${slug}: continuing answer stays on the active thread`,
      category: 'topic_continuation',
      priorTurns,
      objective: 'What are we discussing now?',
      content: `Continuing on ${shorthand}: the next step is to make it measurable so we can tell whether it actually improved things.`,
      intent: 'conversation',
      expectMinComposite: 75,
      expectMin: { continuity: 70 },
    })
    scenarios.push({
      name: `generated ${slug}: demonstrative reference resolves to the active thread`,
      category: 'reference_resolution',
      priorTurns,
      objective: 'What about that?',
      content: `${shorthand[0]!.toUpperCase()}${shorthand.slice(1)} is the active thread -- the next step is making it measurable.`,
      intent: 'conversation',
      // referenceResolution only counts a resolved reference "usable" at >=0.7 confidence; a
      // demonstrative pronoun typically resolves below that bar even when correctly non-ambiguous,
      // so composite (not the reference dimension) is the meaningful floor.
      expectMinComposite: 70,
    })
    scenarios.push({
      name: `generated ${slug}: recommend action gives a grounded recommendation`,
      category: 'business_context',
      priorTurns,
      objective: `Should we prioritize ${topic} next?`,
      content: `Yes, ${topic} should be next -- it is already the active thread and blocking other work until it is measurable.`,
      intent: 'conversation',
      responseAction: 'recommend',
      expectMinComposite: 75,
      expectMin: { meaning: 80 },
    })
    const correctionTurns = [
      ...priorTurns,
      row('user', `Actually, no -- I meant we should deprioritize ${topic} in favor of something more urgent.`, 4),
    ]
    scenarios.push({
      name: `generated ${slug}: correction is reflected as the new current state`,
      category: 'correction_supersession',
      priorTurns: correctionTurns,
      objective: 'What is the current priority?',
      content: `The current priority has shifted away from ${topic} -- something more urgent takes precedence now.`,
      intent: 'conversation',
      expectMinComposite: 70,
      expectMin: { meaning: 80 },
    })
    scenarios.push({
      name: `generated ${slug}: frustrated tone about a stalled thread gets a calm, accountable reply`,
      category: 'tone_frustrated',
      priorTurns,
      objective: `This is taking too long, ${topic} should have been done by now.`,
      content: `You're right that it's taken longer than it should -- here's exactly what's still blocking ${topic} and the fastest path to close it out.`,
      intent: 'conversation',
      // The objective introduces new vocabulary the prior turns don't share, so continuity's
      // per-turn overlap scoring finds no "relevant" prior turn to ground against and scores near
      // zero even for a good reply -- naturalness (the actual point of this scenario) is what matters.
      expectMinComposite: 60,
      expectMin: { naturalness: 80 },
    })
    scenarios.push({
      name: `generated ${slug}: decisive answer on the active thread without hedging`,
      category: 'decisive_answer',
      priorTurns,
      objective: `Should we finish ${topic} this week or next?`,
      content: `This week. ${shorthand[0]!.toUpperCase()}${shorthand.slice(1)} is already the active thread, and waiting only adds risk without adding clarity.`,
      intent: 'conversation',
      responseAction: 'decide',
      // Same continuity characteristic as above: the either/or objective doesn't share vocabulary
      // with the prior turns, so meaning and reasoning (not composite or continuity) certify this
      // scenario.
      expectMinComposite: 55,
      expectMin: { meaning: 80, reasoning: 75 },
    })
  }
  return scenarios
}

export const CEO_CONVERSATION_RUBRIC_CORPUS: readonly RubricScenario[] = [
  ...anchors,
  ...adversarial,
  ...buildGeneratedScenarios(),
]
