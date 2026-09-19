import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Provider Gateway Phase D (2026-09-19): structural invariants the Phase A/B/C work established,
// enforced going forward so they can't silently regress the way the bugs those phases fixed did
// (a live 413-as-BILLING misclassification, a durable-standing design flaw caught by a failing
// test, a no-op env-mutation isolation mechanism that shipped and ran in production for a long
// time before anyone noticed it did nothing). Each check below traces to a real incident or a
// real bug found during this repo's own audits -- this is not a speculative style gate.

const ROOTS = ['src/lib', 'src/app', 'tests', 'scripts']
const TEXT_EXTENSIONS = new Set(['.ts', '.tsx'])
const violations: string[] = []

function walk(root: string): string[] {
  const results: string[] = []
  for (const entry of readdirSync(root)) {
    const path = join(root, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) results.push(...walk(path))
    else if (TEXT_EXTENSIONS.has(path.slice(path.lastIndexOf('.')))) results.push(path)
  }
  return results
}
const files = ROOTS.flatMap(walk)
const contents = files.map((path) => [path, readFileSync(path, 'utf8')] as const)
const byPath = new Map(contents)

// ── Invariant: classifyProviderError's status checks run in the order that keeps a 413 from
// ever reaching the billing regex, and the billing regex never contains the bare, ambiguous
// phrase "quota exceeded" (real rate-limiters use it too, and it durably blocks a provider for
// 24h instead of a 60s cooldown -- see provider-gateway-phase-a.test.ts's own regression test for
// the live incident and the ambiguity bug this guards against). ────────────────────────────────
const controlPlane = byPath.get('src/lib/provider-control-plane.ts')
if (!controlPlane) violations.push('src/lib/provider-control-plane.ts is missing entirely')
else {
  const status413Index = controlPlane.indexOf("status === 413")
  const billingRegexIndex = controlPlane.search(/billing\|payment\|credit/)
  if (status413Index === -1) violations.push('classifyProviderError no longer has an explicit status===413 check')
  else if (billingRegexIndex !== -1 && status413Index > billingRegexIndex) violations.push('classifyProviderError checks the billing regex before status===413 -- a 413 could be misclassified as BILLING again')
  // Whole line, not just the text from the "billing|payment|credit" match point onward -- a
  // regex edit that PREPENDS "quota exceeded|" ahead of "billing|payment|credit" on the same
  // line would otherwise put the phrase before the match point and evade a suffix-only check.
  const billingLine = billingRegexIndex !== -1 ? controlPlane.slice(controlPlane.lastIndexOf('\n', billingRegexIndex) + 1, controlPlane.indexOf('\n', billingRegexIndex)) : ''
  if (/quota exceeded/i.test(billingLine)) violations.push('BILLING regex once again contains the bare "quota exceeded" phrase -- this durably blocks a provider for 24h on what may just be a transient rate limit (see provider-gateway-phase-a.test.ts)')
}

// ── Invariant: PROVIDER_FAILURE_POLICY's shape for the kinds Phase A/B specifically reasoned
// about. Checked structurally (import + assert), not by regex on source text, so this survives
// reformatting and can't be fooled by comments. ───────────────────────────────────────────────
async function checkFailurePolicy(): Promise<void> {
  const { getProviderFailurePolicy } = await import('../src/lib/provider-control-plane')
  const requestTooLarge = getProviderFailurePolicy('REQUEST_TOO_LARGE')
  if (requestTooLarge.affectsProviderHealth !== false) violations.push('REQUEST_TOO_LARGE must never affect provider health -- a request being too large says nothing about the provider itself')
  if (requestTooLarge.retrySameProviderAfterCompaction !== true) violations.push('REQUEST_TOO_LARGE must retry the same provider after compaction, not fail over to a different one')
  const rateLimit = getProviderFailurePolicy('RATE_LIMIT')
  if (rateLimit.standing !== 'cooldown') violations.push('RATE_LIMIT must durably cool the provider down, not just affect the in-memory circuit breaker')
  for (const kind of ['BILLING', 'AUTHENTICATION', 'AUTHORIZATION'] as const) {
    const policy = getProviderFailurePolicy(kind)
    if (policy.standing !== 'blocked') violations.push(`${kind} must durably block the provider -- retrying can never fix an account/credential problem`)
    if (policy.retryable !== false) violations.push(`${kind} must not be marked retryable`)
  }
  // Probabilistic infra failures must stay 'none' on the durable layer -- Phase B's own history
  // (see provider-standing.ts's header comment) includes a real regression where these were
  // over-applied to 'cooldown', breaking a test and punishing transient blips more harshly than
  // the in-memory circuit breaker they sit alongside was ever meant to.
  for (const kind of ['UPSTREAM', 'TIMEOUT', 'NETWORK', 'CATALOG_UNAVAILABLE', 'UNKNOWN'] as const) {
    const policy = getProviderFailurePolicy(kind)
    if (policy.standing !== 'none') violations.push(`${kind} must not durably block/cooldown the provider on a single occurrence -- it is a probabilistic infra signal, governed by the in-memory circuit breaker's own 3-strikes threshold instead`)
    if (policy.affectsProviderHealth !== true) violations.push(`${kind} must still feed the in-memory circuit breaker (affectsProviderHealth)`)
  }
}

// ── Invariant: provider-standing.ts's test/CI write gate stays in place. A real CI-only bug
// (cross-test-file state leak against the shared Postgres test database) was caused by removing
// this exact gate's equivalent; see that file's own comment for the incident. ──────────────────
const standing = byPath.get('src/lib/provider-standing.ts')
if (!standing) violations.push('src/lib/provider-standing.ts is missing entirely')
else if (!/NODE_ENV === 'test' \|\| process\.env\.CI === 'true'/.test(standing)) violations.push("provider-standing.ts's recordProviderStanding must skip its real DB write under NODE_ENV==='test' or CI==='true' -- see its own comment for the cross-test-file leak this prevents")

// ── Invariant: the callLlmWithRetry naming ambiguity (two functions, same name, reachable
// under the same import path, doing genuinely different things) does not reopen. The bridge's
// owner-aware fork must keep its own distinct name. ──────────────────────────────────────────
const bridge = byPath.get('src/lib/agent-canonical-bridge.ts')
if (!bridge) violations.push('src/lib/agent-canonical-bridge.ts is missing entirely')
else {
  // Any local binding of this exact name -- function declaration, const/let arrow function,
  // sync or async -- shadows the `export * from './agent'` re-export the same way the original
  // bug did; the fix wasn't about the `async function` syntax specifically.
  if (/\bfunction\s+callLlmWithRetry\b|\b(?:const|let|var)\s+callLlmWithRetry\s*=/.test(bridge)) violations.push('agent-canonical-bridge.ts must not re-declare callLlmWithRetry locally -- it shadows the export * from ./agent re-export, recreating the two-functions-same-name ambiguity Phase B fixed')
  if (!/export\s+async\s+function\s+runOwnerAwareLlm\b/.test(bridge)) violations.push('agent-canonical-bridge.ts must export its owner-aware fork as runOwnerAwareLlm')
}

// ── Invariant: no file mutates process.env.LLM_PROVIDER_ORDER. It is not read anywhere in the
// canonical routing path (runCanonicalLlm never consults it) -- Phase C found and fixed the one
// call site still doing this, where it silently did nothing while mislabeling responses with the
// wrong provider's name. Request-scoped providerOrder/excludeProviders are the real mechanism. ──
for (const [path, content] of contents) {
  // (?!=) excludes ==/=== comparisons (a read, not a mutation) from matching -- only a genuine
  // single-= assignment is the pattern this guards against.
  if (/process\.env\.LLM_PROVIDER_ORDER\s*=(?!=)/.test(content)) violations.push(`${path} mutates process.env.LLM_PROVIDER_ORDER -- this is never read by the canonical router and is a known-dead, race-prone pattern Phase C removed; use runCanonicalLlm's request-scoped providerOrder/excludeProviders instead`)
}

// ── Invariant: canonical-provider-compat.ts stays deleted (confirmed unimported anywhere when
// removed in Phase C) rather than silently reappearing as an unused, unmaintained duplicate of
// functionality that already lives on real call paths. ──────────────────────────────────────
try { statSync('src/lib/canonical-provider-compat.ts'); violations.push('src/lib/canonical-provider-compat.ts has reappeared -- it was deleted in Phase C as confirmed-dead code; if it is needed again, wire it into a real call site rather than resurrecting an orphaned file') } catch { /* expected: file should not exist */ }

async function main(): Promise<void> {
  await checkFailurePolicy()
  if (violations.length) {
    console.error('Provider gateway invariants audit FAILED')
    for (const violation of violations) console.error(`- ${violation}`)
    process.exit(1)
  }
  console.log(`Provider gateway invariants audit PASSED: ${files.length} files scanned`)
}
main()
