import { resolveOrdinalReference } from './ceo-reference-resolution'
import { getGovernedCandidates, type ActiveProviderId } from './provider-control-plane'
import { pickHalfOpenCandidate } from './provider-intelligence'
import type { PersistedConversationRow } from './ceo-context-composer'

export interface BehavioralProbeResult { name: string; passed: boolean; detail: string }

// Deep-audit recommendation: /api/release-health previously proved deployment identity and that the
// governed-provider runtime can execute a call at all ("Say OK"), but never that any SPECIFIC
// conversational behavior actually works on this exact deployed commit -- the gap between "the pipes are
// connected" and "the water that comes out is correct" is exactly where #112-#115's real production bugs
// lived. These probes are deliberately pure, synchronous, no-network checks (not a full CEO lifecycle
// turn, which would add real LLM cost and multi-second latency to every health poll) -- each one
// exercises the actual fixed function directly, so a future regression in any of them fails this gate
// immediately instead of waiting for the next real incident to surface it. Kept in lib/ (not inline in
// the route) so it stays independently unit-testable without pulling in next/server.
export function verifyBehavioralProbes(): { verified: boolean; probes: BehavioralProbeResult[] } {
  const probes: BehavioralProbeResult[] = []

  // Proves #113: ordinal reference resolution handles markdown-bold-formatted numbered lists, not just
  // bare-digit ones -- the real production bug that forced an unnecessary clarification request when the
  // CEO's own numbered list used standard LLM markdown formatting.
  try {
    const rows: PersistedConversationRow[] = [
      { role: 'user', content: 'Give me two options.', createdAt: Date.now() - 2000 },
      { role: 'assistant', content: '**1. First option**\nDetail one.\n\n**2. Second option**\nDetail two.', createdAt: Date.now() - 1000 },
    ]
    const resolved = resolveOrdinalReference('Explain the second one in more depth.', rows)
    const passed = resolved?.ambiguous === false && Boolean(resolved?.resolvedText?.includes('Second option'))
    probes.push({ name: 'ordinal-reference-markdown-list', passed, detail: passed ? 'resolved correctly against a bold-formatted numbered list' : `resolution did not match expected shape: ${JSON.stringify(resolved)}` })
  } catch (error) {
    probes.push({ name: 'ordinal-reference-markdown-list', passed: false, detail: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200) })
  }

  // Proves #115: the taskType-governance capability table still correctly distinguishes providers that
  // can serve a 'creative' request from ones that can't -- the real production bug where a low attempt
  // budget was wasted entirely on providers structurally incapable of the request's taskType.
  try {
    const creativeIncapable = (['groq', 'cloudflare', 'cerebras'] as ActiveProviderId[]).every((provider) => getGovernedCandidates(provider, 'creative', 'standard').length === 0)
    const creativeCapable = (['mistral', 'openrouter'] as ActiveProviderId[]).every((provider) => getGovernedCandidates(provider, 'creative', 'standard').length > 0)
    const passed = creativeIncapable && creativeCapable
    probes.push({ name: 'taskType-governance-capability-table', passed, detail: passed ? 'creative-incapable and creative-capable providers both correctly classified' : 'governance table classification drifted from the expected shape' })
  } catch (error) {
    probes.push({ name: 'taskType-governance-capability-table', passed: false, detail: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200) })
  }

  // Proves #113: the circuit breaker's half-open primitive is wired and returns a real candidate rather
  // than throwing or returning null for a non-empty input -- the missing state that turned a burst of
  // real transient provider failures into a total, zero-attempt lockout.
  try {
    const picked = pickHalfOpenCandidate(['groq'])
    const passed = picked === 'groq'
    probes.push({ name: 'half-open-candidate-selection', passed, detail: passed ? 'half-open primitive returns a real candidate for a non-empty input' : `unexpected result: ${String(picked)}` })
  } catch (error) {
    probes.push({ name: 'half-open-candidate-selection', passed: false, detail: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200) })
  }

  return { verified: probes.every((probe) => probe.passed), probes }
}
