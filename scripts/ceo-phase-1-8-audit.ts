import { readFileSync, existsSync } from 'node:fs'

const failures: string[] = []
const required = [
  'src/lib/ceo-behavioral-policy.ts',
  'src/lib/ceo-response-finalizer.ts',
  'src/lib/ceo-response-composer.ts',
  'src/lib/ceo-context-composer.ts',
  'src/lib/ceo-conversation-state.ts',
  'src/lib/ceo-context-intelligence.ts',
  'src/lib/ceo-degraded-mode.ts',
  'src/lib/ceo-cognitive-contract.ts',
  'src/lib/ceo-cognitive-lifecycle.ts',
  'src/app/api/agent/route.ts',
  'tests/ceo-response-finalizer.test.ts',
  'docs/CEO-PHASES-1-8-CLOSURE.md',
]
for (const file of required) if (!existsSync(file)) failures.push(`Missing phase 1-8 component: ${file}`)

if (failures.length) {
  console.error('CEO phase 1-8 architecture audit FAILED')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

const read = (file: string) => readFileSync(file, 'utf8')
const policy = read('src/lib/ceo-behavioral-policy.ts')
const finalizer = read('src/lib/ceo-response-finalizer.ts')
const composer = read('src/lib/ceo-response-composer.ts')
const context = read('src/lib/ceo-context-composer.ts')
const state = read('src/lib/ceo-conversation-state.ts')
const intelligence = read('src/lib/ceo-context-intelligence.ts')
const degraded = read('src/lib/ceo-degraded-mode.ts')
const lifecycle = read('src/lib/ceo-cognitive-lifecycle.ts')
const route = read('src/app/api/agent/route.ts')
const contract = read('src/lib/ceo-cognitive-contract.ts')
const test = read('tests/ceo-response-finalizer.test.ts')
const docs = read('docs/CEO-PHASES-1-8-CLOSURE.md')

if (!policy.includes('CEO_INTERNAL_ARTIFACT_TOKENS')) failures.push('No canonical control-plane artifact token registry exists')
if ((policy.match(/CEO_INTERNAL_ARTIFACT_TOKENS/g) ?? []).length < 2) failures.push('Canonical artifact registry is not actually used by detection')
for (const token of ['continuous_loop_trace', 'governed_evolution_cycle', 'evidence_trace']) if (!policy.includes(token)) failures.push(`Canonical artifact registry missing token coverage: ${token}`)
if (finalizer.includes('STRUCTURED_ARTIFACT_TOKENS')) failures.push('Finalizer contains a duplicate artifact-token inventory instead of consuming the canonical registry')
if (!finalizer.includes('CEO_INTERNAL_ARTIFACT_TOKENS')) failures.push('Finalizer is not connected to canonical artifact-token registry')
if (!finalizer.includes('finalResponseHash')) failures.push('Finalizer does not produce immutable response hash')
if (!finalizer.includes('assertFinalResponseInvariant')) failures.push('Finalizer invariant assertion is missing')
if (!finalizer.includes('CEO_FINAL_RESPONSE_ID_MISMATCH')) failures.push('Finalizer identity invariant is incomplete')
if (!composer.includes('finalizeCeoResponseForSurface')) failures.push('Composer does not delegate to the canonical finalizer')
if (composer.includes('INTERNAL_RESPONSE_PATTERNS')) failures.push('Legacy duplicate response sanitizer remains in composer')
if (!context.includes('isConversationalHistoryRow')) failures.push('Context composer does not isolate contaminated assistant history')
if (!context.includes('containsInternalArtifactToken')) failures.push('Context composer lacks assistant-history artifact boundary')
if (context.includes('deriveCeoConversationState(input.persistedMessages') || context.includes('resolveConversationReferences(normalizedCurrent, input.persistedMessages')) failures.push('Context composer still sends raw persisted rows into state/reference derivation')
if (!state.includes('safeConversationRows')) failures.push('Conversation state does not quarantine contaminated assistant history')
if (!state.includes('containsInternalArtifactToken')) failures.push('Conversation state lacks artifact-aware history protection')
if (!intelligence.includes('safeConversationRows')) failures.push('Continuity intelligence does not quarantine contaminated history before scoring')
if (!degraded.includes('safeConversationRows(input.priorConversation')) failures.push('Degraded recovery does not quarantine contaminated prior conversation')
if (!contract.includes('FinalResponseProvenance')) failures.push('Cognitive contract lacks final response provenance')
if (!lifecycle.includes('composeCeoResponse')) failures.push('Lifecycle does not pass its final candidate through the canonical finalizer')
if (!route.includes('response.content') || !route.includes("db.message.create({ data: { conversationId, role: 'assistant', content: response.content } })")) failures.push('CEO route does not persist the canonical lifecycle response content')
if (!route.includes("sse('answer', { content: response.content")) failures.push('CEO route does not transport the canonical lifecycle response content')
if (!test.includes('assertFinalResponseInvariant(tampered)')) failures.push('Final response tamper-detection regression test missing')
if (!test.includes('deriveCeoConversationState(rows)')) failures.push('Contaminated conversation-state regression test missing')
for (const phrase of ['simulatedPersistence', 'simulatedSseAnswer', 'simulatedReload']) if (!test.includes(phrase)) failures.push(`Finalization propagation regression test missing: ${phrase}`)
for (const phrase of ['Phase 1', 'Phase 2', 'Phase 3', 'Phase 4', 'Phase 5', 'Phase 6', 'Phase 7', 'Phase 8']) if (!docs.includes(phrase)) failures.push(`Closure document missing ${phrase}`)

if (failures.length) {
  console.error('CEO phase 1-8 architecture audit FAILED')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}
console.log('CEO phase 1-8 architecture audit PASSED: canonical artifact registry, finalizer identity invariants, conversation/context-intelligence/degraded contamination quarantine, raw-context bypass closure, lifecycle finalization ownership, route persistence/transport wiring, and closure documentation are present.')
