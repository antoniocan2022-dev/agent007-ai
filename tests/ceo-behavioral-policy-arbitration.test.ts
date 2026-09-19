import { describe, expect, test } from 'bun:test'
import { classifyCeoBehavioralModes, selectLeadingCeoBehavioralMode, classifyCeoBehavioralModeSignals, selectLeadingCeoBehavioralModeFromSignals, buildCeoBehavioralPolicy, renderCeoBehavioralPolicy, CEO_BEHAVIORAL_MODES, CEO_BEHAVIORAL_MODE_PRIORITY } from '@/lib/ceo-behavioral-policy'

// Stage 3 of the CEO Conversation Kernel migration (2026-09-18): classifyCeoBehavioralModes's 8 regex
// checks fire independently, so a single message routinely matches several of them at once. Before this
// stage, the rendered policy just listed whichever modes matched in CEO_BEHAVIORAL_MODES' fixed
// declaration order -- an unranked grab-bag, not a decision. These tests certify the arbitration this
// stage adds: a fixed priority order (CEO_BEHAVIORAL_MODE_PRIORITY) picks exactly one leading mode from
// whatever matched. Each scenario below is deliberately constructed so the leading mode differs from
// whichever mode CEO_BEHAVIORAL_MODES' declaration order would put first -- proving real arbitration,
// not just "first match in modes wins" (which would pass trivially and prove nothing, since
// CEO_BEHAVIORAL_MODES happens to list business_partner first).
describe('CEO behavioral mode arbitration (Stage 3)', () => {
  test('guardian outranks operator and business_partner when all three match', () => {
    const message = 'This deployment carries real risk -- please execute the rollback now, it matters for our revenue.'
    const modes = classifyCeoBehavioralModes({ intent: 'tool_action', responseAction: 'execute', currentMessage: message })
    // Sanity: this message genuinely triggers all three, in CEO_BEHAVIORAL_MODES' declaration order
    // (business_partner first) -- so a naive "modes[0]" implementation would wrongly pick
    // business_partner here.
    expect(modes).toEqual(['business_partner', 'operator', 'guardian'])
    expect(selectLeadingCeoBehavioralMode(modes)).toBe('guardian')
  })

  test('operator outranks business_partner when guardian is absent', () => {
    const message = 'Please execute our quarterly growth plan now.'
    const modes = classifyCeoBehavioralModes({ intent: 'tool_action', responseAction: 'execute', currentMessage: message })
    expect(modes).toEqual(['business_partner', 'operator'])
    expect(selectLeadingCeoBehavioralMode(modes)).toBe('operator')
  })

  test('a single matched mode is trivially its own leading mode', () => {
    const message = 'How does the deployment pipeline architecture work?'
    const modes = classifyCeoBehavioralModes({ intent: 'analysis', responseAction: 'explain', currentMessage: message })
    expect(modes).toEqual(['technologist'])
    expect(selectLeadingCeoBehavioralMode(modes)).toBe('technologist')
  })

  test('buildCeoBehavioralPolicy carries leadingMode alongside the full matched set, not in place of it', () => {
    const message = 'This deployment carries real risk -- please execute the rollback now, it matters for our revenue.'
    const policy = buildCeoBehavioralPolicy({ intent: 'tool_action', responseAction: 'execute', currentMessage: message })
    expect(policy.leadingMode).toBe('guardian')
    expect(policy.modes).toEqual(['business_partner', 'operator', 'guardian'])
  })

  test('the rendered policy foregrounds the leading mode and lists the rest as supporting, not as one flat list', () => {
    const message = 'This deployment carries real risk -- please execute the rollback now, it matters for our revenue.'
    const policy = buildCeoBehavioralPolicy({ intent: 'tool_action', responseAction: 'execute', currentMessage: message })
    const rendered = renderCeoBehavioralPolicy(policy)
    expect(rendered).toContain('Primary executive mode: guardian')
    expect(rendered).toContain('Supporting modes: business_partner, operator')
    // The old flat "Executive modes: ..." line is gone -- this is a real format change, not additive.
    expect(rendered).not.toContain('Executive modes:')
  })

  test('selectLeadingCeoBehavioralMode falls back to friend for an empty set (defensive; classifyCeoBehavioralModes itself never returns one)', () => {
    expect(selectLeadingCeoBehavioralMode([])).toBe('friend')
  })

  // Fresh-audit finding (2026-09-18, same day Stage 3 shipped): a test that only checks "each mode,
  // isolated, is its own leading mode" (as several tests above effectively do) cannot distinguish
  // 'friend' genuinely being present in CEO_BEHAVIORAL_MODE_PRIORITY from 'friend' being silently
  // missing from it -- selectLeadingCeoBehavioralMode's own fallback default is 'friend', so a missing
  // entry for it would produce the exact same observable result as a correctly-present one. Comparing
  // the two arrays directly (both exported specifically to make this checkable) closes that blind spot:
  // it fails loudly if a future mode is ever added to CEO_BEHAVIORAL_MODES without a matching priority
  // entry, instead of silently misattributing that mode's leading-mode decisions to 'friend'.
  test('CEO_BEHAVIORAL_MODE_PRIORITY is exactly a permutation of CEO_BEHAVIORAL_MODES -- no mode omitted, none duplicated', () => {
    expect(CEO_BEHAVIORAL_MODE_PRIORITY.length).toBe(CEO_BEHAVIORAL_MODES.length)
    expect([...CEO_BEHAVIORAL_MODE_PRIORITY].sort()).toEqual([...CEO_BEHAVIORAL_MODES].sort())
    expect(new Set(CEO_BEHAVIORAL_MODE_PRIORITY).size).toBe(CEO_BEHAVIORAL_MODE_PRIORITY.length)
  })
})

// Phase 2 of the CEO Conversation Kernel migration (external audit, 2026-09-19), issue 2:
// selectLeadingCeoBehavioralMode's pure static priority (above) cannot distinguish an EXPLICIT signal
// already present in the turn's own execution contract (intent/responseAction) from an INCIDENTAL
// keyword mention in the message text -- both just "the mode matched," ranked purely by
// CEO_BEHAVIORAL_MODE_PRIORITY's fixed order regardless of strength. These tests certify
// selectLeadingCeoBehavioralModeFromSignals, the context-weighted arbitration buildCeoBehavioralPolicy
// now actually uses: guardian still leads unconditionally when present (safety-first, unchanged from
// static priority -- see the function's own comment for why), but among every other matched mode, an
// explicit (hard) signal now outranks a merely incidental (soft) one even when static priority alone
// would have ranked the soft match higher.
describe('CEO behavioral mode arbitration -- context-weighted selection (Phase 2, issue 2)', () => {
  test('an explicit decision request outranks an incidental operator keyword mention, reversing what static priority alone would pick', () => {
    const message = "Let's decide on next quarter's operational rollback procedure for revenue growth."
    const modes = classifyCeoBehavioralModes({ intent: 'decision', responseAction: 'decide', currentMessage: message })
    // Sanity: this message genuinely triggers both business_partner (intent === 'decision') and
    // operator (the "operational"/"rollback"/"procedure" keywords), with no guardian signal present.
    expect(modes).toContain('business_partner')
    expect(modes).toContain('operator')
    expect(modes).not.toContain('guardian')
    // Static priority alone (operator ranks above business_partner in CEO_BEHAVIORAL_MODE_PRIORITY)
    // picks operator here -- even though the user never asked to execute anything, they asked to decide.
    expect(selectLeadingCeoBehavioralMode(modes)).toBe('operator')
    // Context-weighted selection recognizes intent === 'decision' as an explicit, contract-driven signal
    // for business_partner, while operator only matched on incidental procedural vocabulary (responseAction
    // is 'decide', not 'execute'/'verify') -- so it correctly leads with business_partner instead.
    const signals = classifyCeoBehavioralModeSignals({ intent: 'decision', responseAction: 'decide', currentMessage: message })
    expect(selectLeadingCeoBehavioralModeFromSignals(signals)).toBe('business_partner')
    expect(buildCeoBehavioralPolicy({ intent: 'decision', responseAction: 'decide', currentMessage: message }).leadingMode).toBe('business_partner')
  })

  test('guardian still leads unconditionally even when its own match is only incidental (soft), preserving the safety-first guarantee', () => {
    const message = 'This deployment carries real risk -- please execute the rollback now, it matters for our revenue.'
    const signals = classifyCeoBehavioralModeSignals({ intent: 'tool_action', responseAction: 'execute', currentMessage: message })
    // guardian's own match here is soft (intent is 'tool_action', not 'research'; responseAction is
    // 'execute', not 'verify' -- it only matched on the "risk" keyword), while operator's match is hard
    // (responseAction === 'execute'). Guardian must still lead -- this is the exact scenario the
    // original Stage 3 arbitration test pins, now re-verified through the context-weighted path.
    expect(signals.find((signal) => signal.mode === 'guardian')?.hard).toBe(false)
    expect(signals.find((signal) => signal.mode === 'operator')?.hard).toBe(true)
    expect(selectLeadingCeoBehavioralModeFromSignals(signals)).toBe('guardian')
  })

  test('a single matched mode resolves identically under both static and context-weighted selection', () => {
    const message = 'How does the deployment pipeline architecture work?'
    const signals = classifyCeoBehavioralModeSignals({ intent: 'analysis', responseAction: 'explain', currentMessage: message })
    expect(signals.map((signal) => signal.mode)).toEqual(['technologist'])
    expect(selectLeadingCeoBehavioralModeFromSignals(signals)).toBe('technologist')
  })

  test('classifyCeoBehavioralModeSignals never disagrees with classifyCeoBehavioralModes about which modes matched', () => {
    const scenarios = [
      { intent: 'tool_action' as const, responseAction: 'execute' as const, currentMessage: 'This deployment carries real risk -- please execute the rollback now, it matters for our revenue.' },
      { intent: 'decision' as const, responseAction: 'decide' as const, currentMessage: "Let's decide on next quarter's operational rollback procedure for revenue growth." },
      { intent: 'analysis' as const, responseAction: 'explain' as const, currentMessage: 'How does the deployment pipeline architecture work?' },
      { intent: 'conversation' as const, responseAction: 'answer' as const, currentMessage: "I'm feeling really exhausted and frustrated with how things are going." },
    ]
    for (const scenario of scenarios) {
      const modes = classifyCeoBehavioralModes(scenario)
      const signals = classifyCeoBehavioralModeSignals(scenario)
      expect(signals.map((signal) => signal.mode)).toEqual(modes)
    }
  })
})
