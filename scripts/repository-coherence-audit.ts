#!/usr/bin/env bun
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { basename, extname } from 'node:path'

/**
 * Repository Coherence Audit
 *
 * Complements deep-integrity-audit.ts by protecting the repository itself
 * from rapid-upgrade drift: duplicate files, missing canonical modules/tests,
 * stale architecture claims, dependency/lockfile drift, and portability-boundary
 * coupling.
 */

const failures: string[] = []
const record = (condition: boolean, message: string) => { if (!condition) failures.push(message) }
const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').map((path) => path.trim()).filter(Boolean)
const trackedSet = new Set(tracked)
const read = (path: string) => readFileSync(path, 'utf8')
const isSource = (path: string) => /^(src|scripts)\//.test(path) && ['.ts', '.tsx', '.js', '.jsx'].includes(extname(path))

const requiredFiles = [
  'src/lib/provider-intelligence-policy.ts',
  'src/lib/provider-runtime-v2.ts',
  'src/lib/model-intelligence.ts',
  'src/lib/performance-intelligence.ts',
  'src/lib/outcome-intelligence.ts',
  'src/lib/outcome-intelligence.test.ts',
  'src/lib/runtime/public-base-url.ts',
  'src/lib/ceo-reference-resolution.ts',
  'src/lib/ceo-conversation-state.ts',
  'tests/ceo-conversation-semantics.test.ts',
  'tests/ceo-conversation-golden.test.ts',
  'docs/CEO-CONVERSATION-BENCHMARK.md',
  'scripts/deep-integrity-audit.ts',
  'scripts/repository-coherence-audit.ts',
  'scripts/hosting-independence-audit.ts',
  '.github/workflows/autonomy-ci.yml',
  '.github/workflows/hosting-independence-ci.yml',
  'prisma/schema.prisma',
  'package.json',
  'bun.lock',
]
for (const path of requiredFiles) record(trackedSet.has(path), `Required architecture file is missing: ${path}`)

const caseGroups = new Map<string, string[]>()
for (const path of tracked) { const key = path.toLowerCase(); const group = caseGroups.get(key) ?? []; group.push(path); caseGroups.set(key, group) }
for (const [key, group] of caseGroups) if (group.length > 1) failures.push(`Case-insensitive duplicate paths: ${key} => ${group.join(', ')}`)

const byHash = new Map<string, string[]>()
for (const path of tracked.filter(isSource)) { const hash = createHash('sha256').update(read(path)).digest('hex'); const group = byHash.get(hash) ?? []; group.push(path); byHash.set(hash, group) }
for (const [hash, group] of byHash) if (group.length > 1) { const productionCopies = group.filter((path) => !/\.test\.|\.spec\./.test(basename(path))); if (productionCopies.length > 1) failures.push(`Exact duplicate production source files (${hash.slice(0, 12)}): ${productionCopies.join(', ')}`) }

record(read('bun.lock').includes('"lockfileVersion"'), 'bun.lock is missing the Bun lockfile version marker')
record(read('bun.lock').includes('"workspaces"'), 'bun.lock is missing the Bun workspace section')

const readme = read('README.md')
record(!/\b\d+\+? tools\b/i.test(readme), 'README contains a hard-coded tool count')
record(!/\b\d+ sub-?agents?\b/i.test(readme), 'README contains a hard-coded sub-agent count')
record(!/Prisma Models \(\d+\)/i.test(readme), 'README contains a hard-coded Prisma model count')

const portabilityPaths = tracked.filter((path) => path.startsWith('src/lib/runtime/') || path.startsWith('src/lib/storage/') || path.startsWith('src/app/api/checkout/') || path.startsWith('src/app/api/file-download/') || path === 'src/lib/internal-url.ts')
const portabilityAllowlist = new Set(['src/lib/runtime/host-runtime.ts', 'src/lib/runtime/vercel-background.ts', 'src/lib/storage/vercel-blob.ts', 'src/lib/runtime/hosting-independence.test.ts'])
const portabilityFindings = portabilityPaths.filter((path) => !portabilityAllowlist.has(path)).filter((path) => /https?:\/\/[^\s"'`]*vercel\.app|\bVERCEL_URL\b|@vercel\/(?:functions|blob|edge|node|og)/i.test(read(path)))
record(portabilityFindings.length === 0, `Hosting-specific coupling leaked into portability boundary: ${portabilityFindings.join(', ')}`)

const outcome = read('src/lib/outcome-intelligence.ts')
const performance = read('src/lib/performance-intelligence.ts')
const runtime = read('src/lib/provider-runtime-v2.ts')
record(outcome.includes('verified_success') && outcome.includes('verificationPassed'), 'Outcome Intelligence lacks explicit verification semantics')
record(outcome.includes('getPerformanceSnapshot'), 'Outcome Intelligence does not have a conservative performance fallback')
record(performance.includes('recordModelPerformance'), 'Performance Intelligence recorder is missing')
record(runtime.includes('recordModelPerformance'), 'Provider runtime is not feeding observed performance evidence')
record(runtime.includes('outcomeEvidence') && runtime.includes('recordModelOutcome'), 'Provider runtime has no verified outcome evidence integration seam')

// Phase 2 of the CEO Conversation Kernel migration (external audit, 2026-09-19), issue 8: "the current
// one-contract guarantee is strongest in /api/agent, not globally enforced across every possible
// caller because the contract-building APIs still permit fallback reconstruction." Both builders stay
// plain exported functions any file COULD call directly -- correctly so, since a handful of real
// callers legitimately need to (a caller with no canonical contract yet, or a deliberately isolated
// classification with no real conversation history, e.g. ceo-incident-regression-candidate.ts). What
// was missing was anything that would catch a NEW call site silently reintroducing a duplicate build
// instead of reusing the turn's canonical CeoTurnDecision (ceo-turn-decision.ts). These two allowlists
// make that mechanical: any production source file that calls either builder must already be on the
// list below, reviewed and reasoned about, or this audit fails and names the file to review.
const decisionContractCallerAllowlist = new Set([
  'src/lib/ceo-conversation-decision-contract.ts', // the definition itself
  'src/lib/ceo-cognitive-conversation.ts', // renderCanonicalConversationContext's own reuse-guarded fallback
  'src/lib/ceo-context-composer.ts', // Stage 2: the one real per-turn canonical build, reuse-guarded
  'src/lib/ceo-pre-router.ts', // reuse-guarded fallback for callers without a canonical contract yet
  'src/lib/ceo-incident-regression-candidate.ts', // deliberately isolated (empty-history) classification, not this turn's real decision
])
const decisionPlanCallerAllowlist = new Set([
  'src/lib/ceo-cognitive-kernel.ts', // the definition itself
  'src/lib/ceo-turn-decision.ts', // Phase 2: the single per-turn builder (CeoTurnDecision)
  'src/lib/ceo-cognitive-lifecycle.ts', // falls back to building its own only when no caller supplied one
  'src/lib/ceo-operational-direct-response.ts', // same fallback pattern, mirrored
  'scripts/ceo-cognitive-lifecycle-audit.ts', // offline audit tooling, not a request-handling path
])
for (const path of tracked.filter(isSource)) {
  const content = read(path)
  if (/\bbuildConversationDecisionContract\(/.test(content) && !decisionContractCallerAllowlist.has(path)) failures.push(`New/unreviewed call site of buildConversationDecisionContract in ${path} -- reuse the turn's canonical ConversationDecisionContract via CeoTurnDecision (ceo-turn-decision.ts) where one already exists; only add this path to repository-coherence-audit.ts's allowlist after confirming it deliberately needs an independent build.`)
  if (/\bbuildCeoDecisionPlan\(/.test(content) && !decisionPlanCallerAllowlist.has(path)) failures.push(`New/unreviewed call site of buildCeoDecisionPlan in ${path} -- reuse the turn's canonical DecisionPlan via CeoTurnDecision (ceo-turn-decision.ts) where one already exists; only add this path to repository-coherence-audit.ts's allowlist after confirming it deliberately needs an independent build.`)
}

const workflow = read('.github/workflows/autonomy-ci.yml')
record(workflow.includes('bun install --frozen-lockfile'), 'Autonomy CI does not enforce the frozen Bun lockfile gate')
record(workflow.includes('scripts/deep-integrity-audit.ts'), 'Autonomy CI does not run the deep integrity audit')
record(workflow.includes('scripts/repository-coherence-audit.ts'), 'Autonomy CI does not run the repository coherence audit')
record(workflow.includes('src/lib/outcome-intelligence.test.ts'), 'Autonomy CI does not run Outcome Intelligence tests')
record(workflow.includes('tests/ceo-conversation-semantics.test.ts') || workflow.includes('test:conversation'), 'Autonomy CI does not run the CEO conversation benchmark')
record(workflow.includes('tsc -p tsconfig.ci.json --noEmit'), 'Autonomy CI does not enforce the CI TypeScript gate')

if (failures.length) { console.error('Repository coherence audit FAILED:'); for (const failure of failures) console.error(`- ${failure}`); process.exit(1) }
console.log(`Repository coherence audit PASSED: ${tracked.length} tracked files checked; architecture, duplicate-path, duplicate-content, lockfile, documentation, portability-boundary, intelligence, conversational, and CI contracts are coherent.`)
