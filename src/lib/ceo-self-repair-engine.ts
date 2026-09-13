/**
 * Governed self-repair pipeline.
 *
 * Detects recurring classification incidents (ceo-incident-regression-candidate.ts), extracts a
 * candidate correction FROM THE ACTUAL RECURRING TEXT (never invented, never guessed by an LLM with no
 * ground truth to check itself against), validates it against the same fixed corpus of human-reviewed
 * negative examples this codebase's own regression tests already use, and only then either (a) applies
 * it autonomously -- for the narrow, pre-approved-safe class of corrections classifySelfRepairRiskTier
 * allows -- or (b) leaves it as a reviewable candidate for a human, reusing ceo-behavioral-learning.ts's
 * existing candidate/validate/approve/promote state machine exactly as-is.
 *
 * What this deliberately does NOT do, and why: it never has an LLM (or anything else) simply decide what
 * the "correct" classification should have been and encode that guess as new behavior. There is no
 * source of ground truth available to a classifier auditing itself -- an LLM asked "what should this
 * message have been classified as?" is exactly as capable of confidently guessing wrong as the
 * classifier that got it wrong the first time, and encoding that guess as new governing logic is how a
 * system reinforces its own mistakes instead of correcting them. The only signal this module trusts is
 * TEXT THAT ACTUALLY RECURRED (proving a real, reproducible pattern, not a one-off ambiguous case) and
 * VALIDATION AGAINST KNOWN-CORRECT NEGATIVES (proving the correction doesn't also swallow unrelated
 * questions) -- both externally checkable facts, not inferences.
 *
 * It also never rewrites this repository's TypeScript source or touches git: the base classifiers
 * (e.g. ceo-self-reflection.ts's CAPABILITY_RE) stay exactly as they are, reviewed and merged through the
 * normal PR process. An autonomously-approved correction is additive DATA (a Memory-backed learned
 * pattern, read through a TTL-cached, fail-open, synchronous accessor so the hot classification path
 * never takes on DB latency or a new failure mode) layered on top of that reviewed base -- never a
 * replacement for it, and never something the running app could use to alter its own source or deploy
 * itself. Deployment stays a human decision, exactly as everywhere else in this codebase.
 */
import {
  approveLearningCandidate,
  buildLearningCandidate,
  getLearningCandidate,
  persistLearningCandidate,
  promoteLearningCandidate,
  saveValidatedLearningCandidate,
  validateLearningCandidate,
  type LearningCandidate,
} from './ceo-behavioral-learning'
import { classifySelfRepairRiskTier, type SelfRepairRiskTier } from './ceo-self-repair-governance'
import type { IncidentCandidateInputClass, IncidentRegressionCandidate } from './ceo-incident-regression-candidate'

// ---------------------------------------------------------------------------------------------------
// Pure pattern extraction and validation -- no I/O, fully deterministic, fully unit-testable.
// ---------------------------------------------------------------------------------------------------

export interface IncidentCluster { inputClass: IncidentCandidateInputClass; domain?: string; messages: string[]; fingerprints: string[] }

/** Groups incidents by (inputClass, domain) so a repeated FAILURE MODE is visible even when every
 * individual message is worded differently -- a raw fingerprint (ceo-conversation-incident.ts) hashes
 * the full normalized message text, so it only catches literal repeats, not a recurring pattern phrased
 * three different ways. */
export function clusterIncidentCandidates(candidates: readonly IncidentRegressionCandidate[]): IncidentCluster[] {
  const byKey = new Map<string, IncidentCluster>()
  for (const candidate of candidates) {
    const key = `${candidate.inputClass}::${candidate.domain ?? ''}`
    const cluster = byKey.get(key) ?? { inputClass: candidate.inputClass, domain: candidate.domain, messages: [], fingerprints: [] }
    if (!cluster.messages.includes(candidate.message)) cluster.messages.push(candidate.message)
    if (!cluster.fingerprints.includes(candidate.fingerprint)) cluster.fingerprints.push(candidate.fingerprint)
    byKey.set(key, cluster)
  }
  return [...byKey.values()]
}

function tokenize(text: string): string[] { return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean) }
function ngrams(tokens: readonly string[], n: number): string[] { const result: string[] = []; for (let i = 0; i + n <= tokens.length; i += 1) result.push(tokens.slice(i, i + n).join(' ')); return result }

/**
 * Finds the longest word-sequence (6 down to 3 words) that appears in at least `minSupport` of the
 * DISTINCT recurring messages. Longest-first is deliberate: a longer shared phrase is more specific and
 * far less likely to also appear in unrelated text, so it's the safer candidate to propose. Returns null
 * (never guesses) when no phrase clears the support bar at any length -- the recurrence may be real but
 * this module has no safe, grounded correction to offer for it.
 */
export function extractCandidatePhrase(messages: readonly string[], minSupport = 2): string | null {
  const distinct = [...new Set(messages.map((message) => message.trim()).filter(Boolean))]
  if (distinct.length < minSupport) return null
  for (let n = 6; n >= 3; n -= 1) {
    const supportByPhrase = new Map<string, number>()
    for (const message of distinct) { const seenInMessage = new Set(ngrams(tokenize(message), n)); for (const phrase of seenInMessage) supportByPhrase.set(phrase, (supportByPhrase.get(phrase) ?? 0) + 1) }
    const supported = [...supportByPhrase.entries()].filter(([, count]) => count >= minSupport).sort((a, b) => b[1] - a[1])
    if (supported.length) return supported[0][0]
  }
  return null
}

function escapeRegex(text: string): string { return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
export function buildPatternSourceFromPhrase(phrase: string): string { return `\\b${phrase.split(' ').map(escapeRegex).join('\\s+')}\\b` }

// The same human-reviewed negative examples this codebase's own regression tests already hold a
// correction to (tests/ceo-self-reflection.test.ts's "does not steal operational or analytical request"
// and "does not misclassify ordinary business delegation" blocks, plus the two production incidents this
// session fixed directly) -- reusing them here means the autonomous path is held to the identical bar a
// human reviewer already set, not a new, weaker one invented for this module.
export const SELF_REPAIR_SAFE_NEGATIVES: readonly string[] = Object.freeze([
  'Deploy the approved release to production.',
  'Research Agent007 competitors.',
  'Send the customer the invoice.',
  'Create a new venture.',
  'Manage this business for me.',
  'Can you analyze this architecture?',
  'Run this business transaction for me.',
  'Review this customer churn report.',
  'what can I do to give you the numbers you need for the board deck?',
  'how can I enable you to close this deal?',
  'how can I provide you with the budget figures?',
  'what can I do to connect you with the sales team?',
  'how do I give you the go-ahead on this?',
  'Do you have any recent updates on the deal?',
  'What recent changes did you make to the campaign?',
  'check all news and relevant information about GEOS and MIND Technologies',
  'should I buy GEOS or MIND stock?',
])

export interface PatternValidationResult { ok: boolean; reason: string; matchedSupportCount: number; matchedNegativeCount: number }

/** Requires the pattern to match at least 2 (or all, if fewer) of the reported cases -- proving it
 * addresses the real recurring failure -- AND none of the known-safe negatives -- proving it doesn't
 * also swallow an unrelated question. Both checks are mechanical and re-runnable by anyone; nothing here
 * depends on a model's self-report of confidence. */
export function validateProposedPattern(input: { patternSource: string; supportingMessages: readonly string[]; safeNegatives?: readonly string[] }): PatternValidationResult {
  let regex: RegExp
  try { regex = new RegExp(input.patternSource, 'i') } catch { return { ok: false, reason: 'Pattern is not a valid regular expression.', matchedSupportCount: 0, matchedNegativeCount: 0 } }
  const matchedSupportCount = input.supportingMessages.filter((message) => regex.test(message)).length
  const negatives = input.safeNegatives ?? SELF_REPAIR_SAFE_NEGATIVES
  const matchedNegativeCount = negatives.filter((message) => regex.test(message)).length
  const requiredSupport = Math.min(2, input.supportingMessages.length)
  if (matchedSupportCount < requiredSupport) return { ok: false, reason: `Pattern only matches ${matchedSupportCount} of ${input.supportingMessages.length} reported occurrence(s); needs at least ${requiredSupport} to reliably address the recurring failure.`, matchedSupportCount, matchedNegativeCount }
  if (matchedNegativeCount > 0) return { ok: false, reason: `Pattern matches ${matchedNegativeCount} known-safe negative example(s) -- would introduce a false positive like the one found in this session's own PR #148 review.`, matchedSupportCount, matchedNegativeCount }
  return { ok: true, reason: 'Pattern covers the recurring failures and matches none of the known-safe negatives.', matchedSupportCount, matchedNegativeCount }
}

// ---------------------------------------------------------------------------------------------------
// Learned-pattern store and the hot-path read cache.
// ---------------------------------------------------------------------------------------------------

export type SelfRepairTargetClassifier = 'self_reflection_capability'

// Only the categories with an actual wired read-side hook (see ceo-self-reflection.ts) can ever become
// 'active' -- everything else still gets a fully validated, reviewable proposal, just without an
// attachment point yet. Extending coverage to another classifier means wiring its own read hook with the
// same rigor as this one, not widening this map alone.
const CLASSIFIER_HOOK_TARGETS: Partial<Record<IncidentCandidateInputClass, SelfRepairTargetClassifier>> = {
  self_assessment: 'self_reflection_capability',
}

export type LearnedPatternStatus = 'active' | 'awaiting_approval' | 'rejected'

export interface LearnedClassifierPattern {
  schemaVersion: 1
  patternId: string
  targetClassifier: SelfRepairTargetClassifier | null
  inputClass: IncidentCandidateInputClass
  patternSource: string
  riskTier: SelfRepairRiskTier
  status: LearnedPatternStatus
  statusReason: string
  supportingMessages: string[]
  supportingFingerprints: string[]
  learningCandidateId: string
  createdAt: string
  decidedAt: string | null
  decidedBy: string | null
}

async function persistLearnedPattern(pattern: LearnedClassifierPattern): Promise<void> {
  const { db } = await import('./db')
  const key = `learned:pattern:${pattern.patternId}`
  await db.memory.upsert({ where: { key }, create: { key, value: JSON.stringify(pattern), category: 'learned_classifier_pattern' }, update: { value: JSON.stringify(pattern), category: 'learned_classifier_pattern' } })
}

async function getAllLearnedPatterns(): Promise<LearnedClassifierPattern[]> {
  try {
    const { db } = await import('./db')
    const rows = await db.memory.findMany({ where: { category: 'learned_classifier_pattern' }, orderBy: { createdAt: 'desc' } })
    return rows.map((row) => { try { return JSON.parse(row.value) as LearnedClassifierPattern } catch { return null } }).filter((item): item is LearnedClassifierPattern => item !== null)
  } catch { return [] }
}

export async function getLearnedPatternById(patternId: string): Promise<LearnedClassifierPattern | null> {
  const { db } = await import('./db')
  const row = await db.memory.findUnique({ where: { key: `learned:pattern:${patternId}` } }).catch(() => null)
  return row ? (JSON.parse(row.value) as LearnedClassifierPattern) : null
}

export async function listPendingSelfRepairPatterns(limit = 50): Promise<LearnedClassifierPattern[]> {
  const all = await getAllLearnedPatterns()
  return all.filter((pattern) => pattern.status === 'awaiting_approval').slice(0, Math.max(1, Math.min(limit, 200)))
}

async function getActiveLearnedPatterns(targetClassifier: SelfRepairTargetClassifier): Promise<LearnedClassifierPattern[]> {
  const all = await getAllLearnedPatterns()
  return all.filter((pattern) => pattern.status === 'active' && pattern.targetClassifier === targetClassifier)
}

let cachedCapabilityPattern: { loadedAt: number; regex: RegExp | null } | null = null
let capabilityPatternRefreshInFlight: Promise<void> | null = null
const LEARNED_PATTERN_CACHE_TTL_MS = 5 * 60 * 1000

function combinePatternSources(patterns: readonly LearnedClassifierPattern[]): RegExp | null {
  if (!patterns.length) return null
  try { return new RegExp(patterns.map((pattern) => `(?:${pattern.patternSource})`).join('|'), 'i') } catch { return null }
}

async function refreshCapabilityPatternCache(): Promise<void> {
  const patterns = await getActiveLearnedPatterns('self_reflection_capability')
  cachedCapabilityPattern = { loadedAt: Date.now(), regex: combinePatternSources(patterns) }
}

/**
 * Synchronous read for the hot classification path in ceo-self-reflection.ts. Returns whatever was last
 * cached -- null before the first successful load, meaning "use the base classifier only," identical to
 * pre-self-repair behavior -- and kicks off a best-effort background refresh (never awaited, never
 * throws) when the cache is missing or older than the TTL. A slow or failed DB read must never add
 * latency or a new failure mode to the classification path this feeds; staleness is bounded by the TTL
 * (and, across a serverless fleet, by each instance's own independent TTL -- this is eventual
 * consistency, not an instant broadcast), not by anything this function's caller has to manage.
 */
export function getLearnedCapabilityPattern(): RegExp | null {
  const stale = !cachedCapabilityPattern || Date.now() - cachedCapabilityPattern.loadedAt > LEARNED_PATTERN_CACHE_TTL_MS
  if (stale && !capabilityPatternRefreshInFlight) capabilityPatternRefreshInFlight = refreshCapabilityPatternCache().catch(() => {}).finally(() => { capabilityPatternRefreshInFlight = null })
  return cachedCapabilityPattern?.regex ?? null
}

/** Test-only synchronous injection point, so tests never need to fake the DB or wait out the TTL. */
export function __setLearnedCapabilityPatternForTest(regex: RegExp | null): void { cachedCapabilityPattern = { loadedAt: Date.now(), regex } }

// ---------------------------------------------------------------------------------------------------
// Orchestration: scan recent incidents, cluster, propose, risk-tier, auto-activate or queue for review.
// ---------------------------------------------------------------------------------------------------

async function getRecentIncidentCandidates(windowHours: number): Promise<IncidentRegressionCandidate[]> {
  try {
    const { db } = await import('./db')
    const rows = await db.memory.findMany({ where: { category: 'ceo_conversation_incident', createdAt: { gte: new Date(Date.now() - windowHours * 60 * 60 * 1000) } }, orderBy: { createdAt: 'asc' } })
    return rows.map((row) => { try { return JSON.parse(row.value) as IncidentRegressionCandidate } catch { return null } }).filter((item): item is IncidentRegressionCandidate => item !== null)
  } catch { return [] }
}

const MIN_RECURRENCE_TO_PROPOSE = 2

export interface SelfRepairCycleReport {
  scannedCandidates: number
  clustersEvaluated: number
  autoActivated: Array<{ inputClass: IncidentCandidateInputClass; patternSource: string; patternId: string }>
  awaitingApproval: Array<{ inputClass: IncidentCandidateInputClass; reason: string; patternId: string }>
  skipped: Array<{ inputClass: IncidentCandidateInputClass; reason: string }>
}

async function recordCandidate(recordId: string, cluster: IncidentCluster, phrase: string, patternSource: string, validation: PatternValidationResult): Promise<LearningCandidate> {
  const candidate = buildLearningCandidate({
    recommendationId: recordId,
    behavior: `The "${cluster.inputClass}" classifier repeatedly failed to recognize a recurring input across ${cluster.messages.length} distinct message(s).`,
    expectedOutcome: `The shared phrase "${phrase}" is recognized and correctly classified as "${cluster.inputClass}".`,
    actualOutcome: validation.ok ? 'Pattern extracted from the recurring text and validated against the known-safe negative corpus.' : `Pattern extraction/validation failed: ${validation.reason}`,
    predictionError: { kind: 'CATEGORICAL', magnitude: null, direction: 'unknown', explanation: `No existing pattern covered the recurring phrase "${phrase}".` },
    rootCause: `No pattern in the "${cluster.inputClass}" classifier matches "${phrase}", so every message containing it fails classification the same way.`,
    evidenceIds: cluster.fingerprints,
    proposedChange: `Add pattern /${patternSource}/i to the "${cluster.inputClass}" classifier.`,
  })
  await persistLearningCandidate(candidate)
  return candidate
}

type ClusterOutcome =
  | { bucket: 'skipped'; inputClass: IncidentCandidateInputClass; reason: string }
  | { bucket: 'awaitingApproval'; inputClass: IncidentCandidateInputClass; reason: string; patternId: string }
  | { bucket: 'autoActivated'; inputClass: IncidentCandidateInputClass; patternSource: string; patternId: string }

/** Everything one cluster needs done, isolated so a failure processing ONE recurring pattern (e.g. a
 * transient DB write error) can be caught and reported without losing progress on every other cluster in
 * the same cycle -- see runGovernedSelfRepairCycle's per-cluster try/catch. */
async function processCluster(cluster: IncidentCluster): Promise<ClusterOutcome> {
  if (cluster.messages.length < MIN_RECURRENCE_TO_PROPOSE) return { bucket: 'skipped', inputClass: cluster.inputClass, reason: `Only ${cluster.messages.length} distinct occurrence(s) in this window; needs at least ${MIN_RECURRENCE_TO_PROPOSE} before proposing a correction.` }

  const phrase = extractCandidatePhrase(cluster.messages, MIN_RECURRENCE_TO_PROPOSE)
  if (!phrase) return { bucket: 'skipped', inputClass: cluster.inputClass, reason: 'No shared phrase of sufficient length (3-6 words) found across the recurring messages.' }

  const patternSource = buildPatternSourceFromPhrase(phrase)
  const validation = validateProposedPattern({ patternSource, supportingMessages: cluster.messages })
  const recordId = `self-repair:${cluster.inputClass}:${cluster.domain ?? 'none'}:${cluster.fingerprints[0]}`
  const candidate = await recordCandidate(recordId, cluster, phrase, patternSource, validation)
  const patternId = candidate.candidateId
  const riskTier = classifySelfRepairRiskTier({ domain: cluster.domain, inputClass: cluster.inputClass })

  if (!validation.ok) {
    await saveValidatedLearningCandidate(validateLearningCandidate(candidate, { passed: false, testRefs: [`self-repair-engine:${cluster.fingerprints.join(',')}`], notes: validation.reason }))
    await persistLearnedPattern({ schemaVersion: 1, patternId, targetClassifier: null, inputClass: cluster.inputClass, patternSource, riskTier, status: 'rejected', statusReason: validation.reason, supportingMessages: cluster.messages, supportingFingerprints: cluster.fingerprints, learningCandidateId: patternId, createdAt: new Date().toISOString(), decidedAt: new Date().toISOString(), decidedBy: 'self-repair-engine:validation-failed' })
    return { bucket: 'skipped', inputClass: cluster.inputClass, reason: validation.reason }
  }

  await saveValidatedLearningCandidate(validateLearningCandidate(candidate, { passed: true, testRefs: [`self-repair-engine:${cluster.fingerprints.join(',')}`], notes: validation.reason }))

  const targetClassifier = CLASSIFIER_HOOK_TARGETS[cluster.inputClass] ?? null
  const eligibleForAutonomy = riskTier === 'low' && targetClassifier !== null

  if (!eligibleForAutonomy) {
    const reason = riskTier === 'high'
      ? `Domain "${cluster.domain ?? 'unspecified'}" (or inputClass "${cluster.inputClass}") requires human approval before this correction can take effect.`
      : `Risk tier is low, but no autonomous classifier hook is wired for "${cluster.inputClass}" yet -- needs a code change before it can be activated.`
    await persistLearnedPattern({ schemaVersion: 1, patternId, targetClassifier, inputClass: cluster.inputClass, patternSource, riskTier, status: 'awaiting_approval', statusReason: reason, supportingMessages: cluster.messages, supportingFingerprints: cluster.fingerprints, learningCandidateId: patternId, createdAt: new Date().toISOString(), decidedAt: null, decidedBy: null })
    return { bucket: 'awaitingApproval', inputClass: cluster.inputClass, reason, patternId }
  }

  const freshCandidate = await getLearningCandidate(patternId)
  const approved = approveLearningCandidate(freshCandidate ?? candidate, 'self-repair-engine:autonomous-low-risk')
  const promoted = await promoteLearningCandidate(approved, `learned-pattern:${cluster.inputClass}`)
  await persistLearnedPattern({ schemaVersion: 1, patternId, targetClassifier, inputClass: cluster.inputClass, patternSource, riskTier, status: 'active', statusReason: 'Auto-activated: low risk tier, validated pattern, wired classifier hook.', supportingMessages: cluster.messages, supportingFingerprints: cluster.fingerprints, learningCandidateId: promoted.candidateId, createdAt: new Date().toISOString(), decidedAt: new Date().toISOString(), decidedBy: 'self-repair-engine:autonomous-low-risk' })
  cachedCapabilityPattern = null // force this process's next read to reload rather than serve the now-superseded cache
  return { bucket: 'autoActivated', inputClass: cluster.inputClass, patternSource, patternId }
}

/**
 * The one entry point that ties detection to correction. Safe to call repeatedly and often (e.g. from a
 * scheduled trigger) -- every step is idempotent or additive, and a cluster that can't produce a
 * validated pattern is recorded as `skipped` with a concrete reason rather than silently retried forever.
 * Each cluster is processed independently: a thrown error (a transient DB write failure, say) for one
 * cluster is caught and reported as `skipped` rather than aborting the whole cycle and losing every other
 * cluster's already-committed progress.
 */
export async function runGovernedSelfRepairCycle(windowHours = 24 * 7): Promise<SelfRepairCycleReport> {
  const candidates = await getRecentIncidentCandidates(windowHours)
  const clusters = clusterIncidentCandidates(candidates)
  const report: SelfRepairCycleReport = { scannedCandidates: candidates.length, clustersEvaluated: 0, autoActivated: [], awaitingApproval: [], skipped: [] }

  for (const cluster of clusters) {
    if (cluster.messages.length >= MIN_RECURRENCE_TO_PROPOSE) report.clustersEvaluated += 1
    try {
      const outcome = await processCluster(cluster)
      if (outcome.bucket === 'skipped') report.skipped.push({ inputClass: outcome.inputClass, reason: outcome.reason })
      else if (outcome.bucket === 'awaitingApproval') report.awaitingApproval.push({ inputClass: outcome.inputClass, reason: outcome.reason, patternId: outcome.patternId })
      else report.autoActivated.push({ inputClass: outcome.inputClass, patternSource: outcome.patternSource, patternId: outcome.patternId })
    } catch (error) {
      report.skipped.push({ inputClass: cluster.inputClass, reason: `Processing failed: ${error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200)}` })
    }
  }

  return report
}

// ---------------------------------------------------------------------------------------------------
// Human approval surface for `awaiting_approval` patterns -- the explicit, non-bypassable gate for
// every HIGH-risk correction, and the point where an unwired-but-low-risk one can be activated once its
// classifier hook exists.
// ---------------------------------------------------------------------------------------------------

export async function approveSelfRepairPattern(patternId: string, approver: string, reason: string): Promise<LearnedClassifierPattern> {
  if (!approver.trim() || !reason.trim()) throw new Error('Self-repair pattern approval requires an approver and a reason.')
  const pattern = await getLearnedPatternById(patternId)
  if (!pattern) throw new Error(`Self-repair pattern not found: ${patternId}`)
  if (pattern.status !== 'awaiting_approval') throw new Error(`Self-repair pattern ${patternId} is not awaiting approval (status: ${pattern.status}).`)
  const candidate = await getLearningCandidate(pattern.learningCandidateId)
  if (!candidate) throw new Error(`Underlying learning candidate not found for pattern ${patternId}.`)
  const approved = approveLearningCandidate(candidate, approver.trim())
  await promoteLearningCandidate(approved, `learned-pattern:${pattern.inputClass}`)
  const updated: LearnedClassifierPattern = { ...pattern, status: pattern.targetClassifier ? 'active' : 'awaiting_approval', statusReason: pattern.targetClassifier ? `Approved by ${approver.trim()}: ${reason.trim()}` : `${pattern.statusReason} (Approved by ${approver.trim()}, but still has no wired classifier hook.)`, decidedAt: new Date().toISOString(), decidedBy: approver.trim() }
  await persistLearnedPattern(updated)
  if (updated.status === 'active') cachedCapabilityPattern = null
  return updated
}

export async function rejectSelfRepairPattern(patternId: string, approver: string, reason: string): Promise<LearnedClassifierPattern> {
  if (!approver.trim() || !reason.trim()) throw new Error('Self-repair pattern rejection requires an approver and a reason.')
  const pattern = await getLearnedPatternById(patternId)
  if (!pattern) throw new Error(`Self-repair pattern not found: ${patternId}`)
  if (pattern.status !== 'awaiting_approval') throw new Error(`Self-repair pattern ${patternId} is not awaiting approval (status: ${pattern.status}).`)
  const updated: LearnedClassifierPattern = { ...pattern, status: 'rejected', statusReason: `Rejected by ${approver.trim()}: ${reason.trim()}`, decidedAt: new Date().toISOString(), decidedBy: approver.trim() }
  await persistLearnedPattern(updated)
  return updated
}
