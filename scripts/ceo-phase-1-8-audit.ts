import { readFileSync, existsSync } from 'node:fs'

const failures: string[] = []
const required = [
  'src/lib/ceo-behavioral-policy.ts',
  'src/lib/ceo-response-contract.ts',
  'src/lib/ceo-control-plane-summary.ts',
  'src/lib/ceo-response-finalizer.ts',
  'src/lib/ceo-response-composer.ts',
  'src/lib/ceo-response-persistence.ts',
  'src/lib/ceo-context-composer.ts',
  'src/lib/ceo-conversation-state.ts',
  'src/lib/ceo-context-intelligence.ts',
  'src/lib/ceo-world-model.ts',
  'src/lib/ceo-response-quality-gate.ts',
  'src/lib/ceo-degraded-mode.ts',
  'src/lib/ceo-cognitive-contract.ts',
  'src/lib/ceo-cognitive-lifecycle.ts',
  'src/lib/db.ts',
  'src/app/api/agent/route.ts',
  'tests/ceo-response-finalizer.test.ts',
  'tests/ceo-response-contract.test.ts',
  'docs/CEO-PHASES-1-8-CLOSURE.md',
  'docs/CEO-AUTHORITATIVE-RESPONSE-CONTRACT.md',
]
for (const file of required) if (!existsSync(file)) failures.push(`Missing Phase 1–8 component: ${file}`)

if (failures.length) { console.error('CEO Phase 1–8 architecture audit FAILED'); for (const failure of failures) console.error(`- ${failure}`); process.exit(1) }

const read = (file: string) => readFileSync(file, 'utf8')
const policy = read('src/lib/ceo-behavioral-policy.ts')
const responseContract = read('src/lib/ceo-response-contract.ts')
const controlPlane = read('src/lib/ceo-control-plane-summary.ts')
const finalizer = read('src/lib/ceo-response-finalizer.ts')
const composer = read('src/lib/ceo-response-composer.ts')
const persistence = read('src/lib/ceo-response-persistence.ts')
const context = read('src/lib/ceo-context-composer.ts')
const state = read('src/lib/ceo-conversation-state.ts')
const intelligence = read('src/lib/ceo-context-intelligence.ts')
const worldModel = read('src/lib/ceo-world-model.ts')
const qualityGate = read('src/lib/ceo-response-quality-gate.ts')
const degraded = read('src/lib/ceo-degraded-mode.ts')
const lifecycle = read('src/lib/ceo-cognitive-lifecycle.ts')
const db = read('src/lib/db.ts')
const route = read('src/app/api/agent/route.ts')
const contract = read('src/lib/ceo-cognitive-contract.ts')
const test = read('tests/ceo-response-finalizer.test.ts')
const responseTest = read('tests/ceo-response-contract.test.ts')
const docs = read('docs/CEO-PHASES-1-8-CLOSURE.md')
const authoritativeDocs = read('docs/CEO-AUTHORITATIVE-RESPONSE-CONTRACT.md')

if (!policy.includes('CEO_INTERNAL_ARTIFACT_TOKENS')) failures.push('No canonical control-plane artifact token registry exists')
if ((policy.match(/CEO_INTERNAL_ARTIFACT_TOKENS/g) ?? []).length < 2) failures.push('Canonical artifact registry is not actually used by detection')
for (const token of ['continuous_loop_trace','governed_evolution_cycle','evidence_trace']) if (!policy.includes(token)) failures.push(`Canonical artifact registry missing token coverage: ${token}`)
if (finalizer.includes('STRUCTURED_ARTIFACT_TOKENS')) failures.push('Finalizer contains a duplicate artifact-token inventory')
if (!finalizer.includes('CEO_INTERNAL_ARTIFACT_TOKENS')) failures.push('Finalizer is not connected to canonical artifact-token registry')
if (!finalizer.includes('CeoResponseDecisionEnvelope')) failures.push('Finalizer is not bound to the authoritative candidate/decision envelope')
if (!finalizer.includes('CEO_RESPONSE_CANDIDATE_MISMATCH')) failures.push('Finalizer does not reject candidate identity mismatch')
if (!finalizer.includes('finalResponseHash')) failures.push('Finalizer does not produce immutable response hash')
if (!finalizer.includes('assertFinalResponseInvariant')) failures.push('Finalizer invariant assertion is missing')
if (!finalizer.includes('CEO_FINAL_RESPONSE_ID_MISMATCH')) failures.push('Finalizer identity invariant is incomplete')
if (!responseContract.includes('buildCeoResponseCandidate')) failures.push('Authoritative candidate constructor is missing')
if (!responseContract.includes('decideCeoCandidate')) failures.push('Authoritative quality decision constructor is missing')
if (!responseContract.includes('controlPlaneSummary')) failures.push('Authoritative envelope is not bound to typed control-plane summary')
if (!responseContract.includes('assertCeoResponseDecisionEnvelope')) failures.push('Authoritative response decision envelope invariant is missing')
if (!controlPlane.includes('export type { CeoControlPlaneSummary }')) failures.push('Typed control-plane summary does not reuse the canonical contract type')
if (!controlPlane.includes('assertCeoControlPlaneSummary')) failures.push('Typed control-plane summary invariant is missing')
if (!composer.includes('buildCeoControlPlaneSummary')) failures.push('Composer does not create the typed control-plane summary')
if (!composer.includes('buildAuthoritativeCeoResponseDecision')) failures.push('Composer does not build the authoritative candidate/decision envelope')
if (!composer.includes('finalizeCeoResponseForSurface')) failures.push('Composer does not delegate to the canonical finalizer')
if (composer.includes('INTERNAL_RESPONSE_PATTERNS')) failures.push('Legacy duplicate response sanitizer remains in composer')
if (!context.includes('isConversationalHistoryRow')) failures.push('Context composer does not isolate contaminated assistant history')
if (!context.includes('containsInternalArtifactToken')) failures.push('Context composer lacks assistant-history artifact boundary')
if (context.includes('deriveCeoConversationState(input.persistedMessages') || context.includes('resolveConversationReferences(normalizedCurrent, input.persistedMessages')) failures.push('Context composer still sends raw persisted rows into state/reference derivation')
if (!state.includes('safeConversationRows')) failures.push('Conversation state does not quarantine contaminated assistant history')
if (!state.includes('containsInternalArtifactToken')) failures.push('Conversation state lacks artifact-aware history protection')
if (!intelligence.includes('safeConversationRows')) failures.push('Continuity intelligence does not quarantine contaminated history before scoring')
if (!worldModel.includes('safeConversationRows')) failures.push('World model does not quarantine contaminated conversation history')
if (!qualityGate.includes('safeConversationRows(input.priorTurns')) failures.push('Quality gate does not quarantine contaminated prior conversation')
if (!qualityGate.includes('safeConversationRows(input.relevantOlderMessages')) failures.push('Quality gate does not quarantine contaminated older conversation')
if (!degraded.includes('safeConversationRows(input.priorConversation')) failures.push('Degraded recovery does not quarantine contaminated prior conversation')
if (!contract.includes('CeoResponseCandidate') || !contract.includes('CeoQualityDecision') || !contract.includes('CeoControlPlaneSummary')) failures.push('Cognitive contract does not own the canonical response contract types')
if (!lifecycle.includes('composeCeoResponse')) failures.push('Lifecycle does not pass its candidate through the canonical finalizer path')
if (!persistence.includes('persistCeoAssistantMessage')) failures.push('Transactional CEO response persistence adapter is missing')
if (!persistence.includes('$transaction')) failures.push('CEO response persistence is not atomic')
if (!persistence.includes('finalResponseHash') || !persistence.includes('finalizationId')) failures.push('Persistence adapter does not record final response identity')
if (!persistence.includes("entity: 'Message'") || !persistence.includes("action: 'ceo_response_finalized'")) failures.push('Persistence lineage is not keyed to Message identity')
if (!db.includes('export const db')) failures.push('Canonical Prisma client surface is missing')
if (!route.includes('safeConversationRows')) failures.push('API route does not use the canonical conversation boundary')
if (!route.includes('persistCeoAssistantMessage')) failures.push('CEO route does not use transactional canonical persistence')
if (!route.includes('updateCeoAssistantMessage')) failures.push('Operational synthesis does not use transactional canonical persistence')
if (!route.includes("sse('answer', { content: response.content")) failures.push('CEO route does not transport canonical lifecycle response content')
if (!route.includes("sse('answer', { content: synthesis.content")) failures.push('Operational route does not transport canonical synthesis content')
if (!test.includes('assertFinalResponseInvariant(tampered)')) failures.push('Final response tamper-detection regression test missing')
if (!test.includes('deriveCeoConversationState(rows)')) failures.push('Contaminated conversation-state regression test missing')
if (!responseTest.includes('CeoControlPlaneSummary') || !responseTest.includes('CEO_RESPONSE_CANDIDATE_MISMATCH')) failures.push('Authoritative response contract regression coverage is incomplete')
for (const phrase of ['simulatedPersistence','simulatedSseAnswer','simulatedReload']) if (!test.includes(phrase)) failures.push(`Finalization propagation regression test missing: ${phrase}`)
for (const phrase of ['Phase 1','Phase 2','Phase 3','Phase 4','Phase 5','Phase 6','Phase 7','Phase 8']) if (!docs.includes(phrase)) failures.push(`Closure document missing ${phrase}`)
if (!authoritativeDocs.includes('ONE CANDIDATE OBJECT') || !authoritativeDocs.includes('ONE IMMUTABLE QUALITY DECISION') || !authoritativeDocs.includes('DATABASE')) failures.push('Authoritative response contract documentation is incomplete')

if (failures.length) { console.error('CEO Phase 1–8 architecture audit FAILED'); for (const failure of failures) console.error(`- ${failure}`); process.exit(1) }
console.log('CEO Phase 1–8 architecture audit PASSED: one authoritative candidate/quality envelope, typed control-plane summary, canonical finalizer identity invariants, safe conversation boundaries, transactional persistence lineage, route transport/persistence wiring, regression proof, and governance documentation are present.')
