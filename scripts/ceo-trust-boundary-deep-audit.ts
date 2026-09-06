import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const failures: string[] = []

function read(path: string): string {
  if (!existsSync(path)) {
    failures.push(`Missing required file: ${path}`)
    return ''
  }
  return readFileSync(path, 'utf8')
}

function requireText(source: string, path: string, patterns: string[], label: string): void {
  for (const pattern of patterns) if (!source.includes(pattern)) failures.push(`${label}: ${path} is missing ${pattern}`)
}

function hash(text: string): string { return createHash('sha256').update(text, 'utf8').digest('hex') }

const route = read('src/app/api/agent/route.ts')
const conversationListApi = read('src/app/api/conversations/route.ts')
const conversationApi = read('src/app/api/conversations/[id]/route.ts')
const conversationProjection = read('src/lib/ceo-conversation-public-projection.ts')
const transport = read('src/lib/ceo-public-transport.ts')
const memoryVisibility = read('src/lib/ceo-memory-visibility.ts')
const behavioral = read('src/lib/ceo-behavioral-policy.ts')
const contract = read('src/lib/ceo-response-contract.ts')
const cognitiveContract = read('src/lib/ceo-cognitive-contract.ts')
const cognitiveKernel = read('src/lib/ceo-cognitive-kernel.ts')
const finalizer = read('src/lib/ceo-response-finalizer.ts')
const composer = read('src/lib/ceo-response-composer.ts')
const lifecycle = read('src/lib/ceo-cognitive-lifecycle.ts')
const persistence = read('src/lib/ceo-response-persistence.ts')
const qualityGate = read('src/lib/ceo-response-quality-gate.ts')
const context = read('src/lib/ceo-context-composer.ts')
const state = read('src/lib/ceo-conversation-state.ts')
const intelligence = read('src/lib/ceo-context-intelligence.ts')
const worldModel = read('src/lib/ceo-world-model.ts')
const degraded = read('src/lib/ceo-degraded-mode.ts')
const phaseAudit = read('scripts/ceo-phase-1-8-audit.ts')
const workflow = read('.github/workflows/ceo-cognitive-lifecycle-ci.yml')

// 1. CLOSE PUBLIC TRANSPORT LEAK
requireText(route, 'src/app/api/agent/route.ts', ['projectCeoPublicSsePayload', 'resolveCeoPublicSseEvent'], 'Public transport boundary')
requireText(transport, 'src/lib/ceo-public-transport.ts', ['PUBLIC_FIELDS_BY_EVENT', 'resolveCeoPublicSseEvent', 'projectCeoPublicSsePayload'], 'Public transport module')
if (/\{\.\.\.\(data as Record<string, unknown>\)\}/.test(route)) failures.push('Public transport leak: route still spreads arbitrary SSE data')
if (/answer:[^\n]*decisionContract/.test(transport) || /done:[^\n]*decisionContract/.test(transport)) failures.push('Public transport leak: decisionContract is allowlisted')
for (const sensitiveField of ['executionContract', 'quality', 'evidenceTrace', 'cognitiveMetrics', 'context', 'releaseAttestation']) {
  if (new RegExp(`answer:[^\n]*${sensitiveField}`).test(transport) || new RegExp(`done:[^\n]*${sensitiveField}`).test(transport)) failures.push(`Public transport leak: ${sensitiveField} is allowlisted on a public response event`)
}
if (transport.includes("| 'thought'")) failures.push('Public transport leak: internal thought is a supported public SSE event')
if (transport.includes("| 'reasoning'")) failures.push('Public transport leak: internal reasoning is a supported public SSE event')

// 2. PRESERVE DECISION IDENTITY
requireText(cognitiveContract, 'src/lib/ceo-cognitive-contract.ts', ['responseAction?: ResponseAction'], 'Decision provenance')
requireText(contract, 'src/lib/ceo-response-contract.ts', ['buildCeoResponseCandidate', 'decideCeoCandidate', 'CeoResponseDecisionEnvelope', 'assertCeoResponseDecisionEnvelope'], 'Decision contract')
requireText(composer, 'src/lib/ceo-response-composer.ts', ['responseAction: input.responseAction ?? input.quality.finalResponseProvenance?.responseAction'], 'Composer decision identity')
requireText(lifecycle, 'src/lib/ceo-cognitive-lifecycle.ts', ['responseAction: request.decisionContract?.responseAction'], 'Lifecycle decision identity')
requireText(finalizer, 'src/lib/ceo-response-finalizer.ts', ['qualityDecisionId', 'candidateHash', 'responseAction: input.decisionEnvelope.controlPlaneSummary.responseAction'], 'Final decision identity')
if (contract.includes('decisionId:') && !contract.includes('candidate.contentHash')) failures.push('Decision identity is not bound to the candidate hash')

// 3. ENFORCE FINAL/PERSISTED IDENTITY
requireText(finalizer, 'src/lib/ceo-response-finalizer.ts', ['finalResponseHash', 'ceo-final-', 'assertFinalResponseInvariant'], 'Final response identity')
requireText(persistence, 'src/lib/ceo-response-persistence.ts', ['$transaction', 'CEO_RESPONSE_PERSISTENCE_HASH_MISMATCH', 'CEO_RESPONSE_PERSISTENCE_ID_MISMATCH', 'finalResponseHash', 'finalizationId'], 'Persistence identity')
if (route.includes('persistCeoAssistantMessage({ conversationId, content: response.content, provenance')) requireText(route, 'src/app/api/agent/route.ts', ['throw persistErr'], 'CEO persistence fail-closed')
if (route.includes('updateCeoAssistantMessage({ messageId: result.persistedAssistantMessageId')) requireText(route, 'src/app/api/agent/route.ts', ['throw persistErr'], 'Operational synthesis persistence fail-closed')

// 4. PROJECT TRUSTED CONTEXT
requireText(behavioral, 'src/lib/ceo-behavioral-policy.ts', ['safeConversationRows'], 'Trusted conversation context')
requireText(context, 'src/lib/ceo-context-composer.ts', ['safeConversationRows'], 'Context projection')
requireText(route, 'src/app/api/agent/route.ts', ['safeContextRows', 'safeConversationRows'], 'Route context projection')
requireText(memoryVisibility, 'src/lib/ceo-memory-visibility.ts', ['CONVERSATIONAL_VISIBLE_CATEGORIES', 'filterConversationalMemories'], 'Memory visibility')
requireText(route, 'src/app/api/agent/route.ts', ['filterConversationalMemories'], 'Route memory projection')

// 5. KEEP UNSAFE HISTORY OUT OF PROJECTION
for (const [name, source] of [['state', state], ['intelligence', intelligence], ['worldModel', worldModel], ['qualityGate', qualityGate], ['degraded', degraded]] as const) {
  if (!source.includes('safeConversationRows')) failures.push(`Unsafe-history boundary missing from ${name} consumer`)
}
if (context.includes('deriveCeoConversationState(input.persistedMessages')) failures.push('Unsafe-history bypass: raw persisted messages reach conversation-state derivation')
if (context.includes('resolveConversationReferences(normalizedCurrent, input.persistedMessages')) failures.push('Unsafe-history bypass: raw persisted messages reach reference resolution')
requireText(conversationApi, 'src/app/api/conversations/[id]/route.ts', ['projectCeoConversationForPublic', "where: { role: { in: ['user', 'assistant'] } }"], 'Conversation reload projection')
requireText(conversationProjection, 'src/lib/ceo-conversation-public-projection.ts', ['projectCeoConversationForPublic', "row.role === 'user' || row.role === 'assistant'"], 'Conversation public projection')
if (conversationApi.includes('include: { Message: { orderBy: { createdAt:')) failures.push('Conversation reload API exposes raw Message rows')
requireText(conversationListApi, 'src/app/api/conversations/route.ts', ["error: 'Unable to load conversations.'", "error: 'Unable to create conversation.'"], 'Conversation list error boundary')
if (conversationListApi.includes("e?.message?.slice(0, 150)")) failures.push('Conversation list API leaks raw exception messages')

// 6. KEEP TOKEN DETECTION AS LAST DEFENSE
requireText(behavioral, 'src/lib/ceo-behavioral-policy.ts', ['CEO_INTERNAL_ARTIFACT_TOKENS'], 'Canonical token registry')
requireText(finalizer, 'src/lib/ceo-response-finalizer.ts', ['CEO_INTERNAL_ARTIFACT_TOKENS', 'containsInternalArtifactToken'], 'Final token defense')
if (finalizer.includes('STRUCTURED_ARTIFACT_TOKENS')) failures.push('Duplicate token inventory remains in finalizer')

// 7. FAIL CHEAP
for (const expensiveMarker of ['runCanonicalLlm(', 'probeProvider(']) for (const [name, source] of [['transport', transport], ['memoryVisibility', memoryVisibility], ['persistence', persistence], ['conversationProjection', conversationProjection]] as const) if (source.includes(expensiveMarker)) failures.push(`Fail-cheap boundary violated: ${name} contains ${expensiveMarker}`)

// 8. ESCALATE ONLY WHEN NECESSARY
requireText(lifecycle, 'src/lib/ceo-cognitive-lifecycle.ts', ['attemptValidatedReasoningProvider', 'tryDegraded'], 'Escalation controls')
requireText(lifecycle, 'src/lib/ceo-cognitive-lifecycle.ts', ['selectedVerification', 'maxProviderAttempts'], 'Bounded escalation')
if (!lifecycle.includes('semanticSubstanceCheck')) failures.push('Deep-task safeguard missing: semantic substance check is absent')

// 9. PRESERVE DEEP REASONING FOR DEEP TASKS
requireText(cognitiveKernel, 'src/lib/ceo-cognitive-kernel.ts', ['reasoningStrategy', 'cognitiveDepth', 'maxEscalations', 'maxProviderAttempts'], 'Adaptive depth routing')
requireText(lifecycle, 'src/lib/ceo-cognitive-lifecycle.ts', ['buildRefinementPrompt', 'buildReviewPrompt', 'buildSynthesisPrompt', 'independent_review'], 'Deep reasoning stages')
requireText(lifecycle, 'src/lib/ceo-cognitive-lifecycle.ts', ['decisionPlan.path', 'decisionPlan.reasoningStrategy'], 'Lifecycle depth integration')

// 10. PROTECT main WITH REQUIRED CI
read('.github/CODEOWNERS')
requireText(workflow, '.github/workflows/ceo-cognitive-lifecycle-ci.yml', ['push:\n    branches: [main]', 'bun run audit:ceo-phase-1-8', 'bunx tsc -p tsconfig.ceo-lifecycle.json --noEmit'], 'Required CEO CI')
requireText(workflow, '.github/workflows/ceo-cognitive-lifecycle-ci.yml', ['bun test tests/ceo-public-transport.test.ts'], 'Public transport CI regression')

// Recursive duplicate-content and transient-workflow scan across canonical CEO surfaces.
function collectFiles(dir: string): string[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return []
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === '.git') continue
    const path = join(dir, entry)
    const info = statSync(path)
    if (info.isDirectory()) found.push(...collectFiles(path))
    else if (info.isFile() && /\.(ts|tsx|js|jsx|yml|yaml|json|md)$/.test(entry) && /ceo|cognitive|response|transport|memory|trust|conversation/i.test(path)) found.push(path)
  }
  return found
}
const files = ['src/lib', 'src/app/api/agent', 'src/app/api/conversations', 'scripts', 'tests', 'docs', '.github/workflows'].flatMap(collectFiles)
const hashes = new Map<string, string[]>()
for (const file of files) {
  const digest = hash(readFileSync(file, 'utf8'))
  const list = hashes.get(digest) ?? []
  list.push(file)
  hashes.set(digest, list)
}
for (const [digest, matches] of hashes) if (matches.length > 1) failures.push(`Duplicate file content detected (${digest.slice(0, 12)}): ${matches.join(', ')}`)
for (const forbidden of ['ceo-boundary-hardening-once.yml', 'ceo-response-action-hardening-once.yml', 'ceo-public-event-hardening-once.yml']) if (existsSync(join('.github/workflows', forbidden))) failures.push(`Transient one-shot workflow remains in repository: ${forbidden}`)

requireText(phaseAudit, 'scripts/ceo-phase-1-8-audit.ts', ['ceo-public-transport.ts', 'ceo-memory-visibility.ts'], 'Phase 1–8 integration')

if (failures.length) {
  console.error('CEO TRUST-BOUNDARY DEEP AUDIT: FAILED')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('CEO TRUST-BOUNDARY DEEP AUDIT: PASSED')
console.log('Verified: public transport isolation, decision identity, final/persisted identity, trusted context, unsafe-history exclusion including reload/list API, last-defense token detection, fail-cheap boundaries, bounded escalation, deep reasoning preservation, required-CI configuration, recursive duplicate-content scan, and transient workflow cleanup.')
