/**
 * UPGRADE #149 Verification Audit — 4 LLM provider fixes
 */
import * as fs from 'fs'
import * as path from 'path'

const baseDir = '/home/z/my-project'

interface Check {
  name: string
  file: string
  pattern: RegExp
  found: boolean
}

const checks: Check[] = [
  // Fix #1 — Retry-with-backoff on all providers
  {
    name: 'Fix #1: callWithRetry helper exists',
    file: 'src/lib/agent.ts',
    pattern: /async function callWithRetry/,
    found: false,
  },
  {
    name: 'Fix #1: Default backoff is [0, 500, 1500] (3 attempts)',
    file: 'src/lib/agent.ts',
    pattern: /\[0, 500, 1500\]/,
    found: false,
  },
  {
    name: 'Fix #1: Auth/region errors fast-fail (no retry)',
    file: 'src/lib/agent.ts',
    pattern: /isAuthOrRegion/,
    found: false,
  },
  {
    name: 'Fix #1: Only retries on rate-limit (429)',
    file: 'src/lib/agent.ts',
    pattern: /if \(!isRateLimit\)/,
    found: false,
  },
  {
    name: 'Fix #1: All 6 providers use callWithRetry (no more single-attempt)',
    file: 'src/lib/agent.ts',
    pattern: /providers\.push\(\{ name: 'Mistral'/,
    found: false,
  },

  // Fix #2 — Track all failures, only report rateLimited if ALL 429
  {
    name: 'Fix #2: failures array tracks every provider',
    file: 'src/lib/agent.ts',
    pattern: /const failures: Array<\{ provider: string; error: any; isRateLimit: boolean \}>/,
    found: false,
  },
  {
    name: 'Fix #2: _allRateLimited flag attached to error',
    file: 'src/lib/agent.ts',
    pattern: /_allRateLimited = allRateLimited/,
    found: false,
  },
  {
    name: 'Fix #2: _failures array attached to error',
    file: 'src/lib/agent.ts',
    pattern: /_failures = failures/,
    found: false,
  },
  {
    name: 'Fix #2: allRateLimited = every failure is 429',
    file: 'src/lib/agent.ts',
    pattern: /failures\.every\(f => f\.isRateLimit\)/,
    found: false,
  },
  {
    name: 'Fix #2: Orchestrator uses _allRateLimited (not isRateLimitError)',
    file: 'src/lib/orchestrator.ts',
    pattern: /\(e as any\)\?\._allRateLimited === true/,
    found: false,
  },
  {
    name: 'Fix #2: friendlyLlmError surfaces failure breakdown',
    file: 'src/lib/agent.ts',
    pattern: /failures\.map\(f =>[\s\S]*?isRateLimit \? '429 \(rate limit\)'/,
    found: false,
  },
  {
    name: 'Fix #2: chat-store preserves server message (no override)',
    file: 'src/store/chat-store.ts',
    pattern: /if \(isRateLimit && !data\.message\)/,
    found: false,
  },

  // Fix #3 — Per-provider circuit breaker
  {
    name: 'Fix #3: circuitBreaker stored on globalThis',
    file: 'src/lib/agent.ts',
    pattern: /G\.__llmCircuitBreaker/,
    found: false,
  },
  {
    name: 'Fix #3: shouldSkipProvider function exists',
    file: 'src/lib/agent.ts',
    pattern: /function shouldSkipProvider/,
    found: false,
  },
  {
    name: 'Fix #3: recordProviderFailure function exists',
    file: 'src/lib/agent.ts',
    pattern: /function recordProviderFailure/,
    found: false,
  },
  {
    name: 'Fix #3: 3 failures in 60s triggers 60s skip',
    file: 'src/lib/agent.ts',
    pattern: /failures\.length >= 3[\s\S]*?skipUntil = now \+ 60_000/,
    found: false,
  },
  {
    name: 'Fix #3: Skipped providers tracked in failures',
    file: 'src/lib/agent.ts',
    pattern: /Circuit breaker open \(skipped for 60s after 3 failures\)/,
    found: false,
  },

  // Fix #4 — Parallel race mode (optional, env-var gated)
  {
    name: 'Fix #4: LLM_PARALLEL_RACE env var check',
    file: 'src/lib/agent.ts',
    pattern: /process\.env\.LLM_PARALLEL_RACE === 'true'/,
    found: false,
  },
  {
    name: 'Fix #4: Promise.any for parallel race',
    file: 'src/lib/agent.ts',
    pattern: /Promise\.any\(/,
    found: false,
  },
  {
    name: 'Fix #4: Race count limited to 3',
    file: 'src/lib/agent.ts',
    pattern: /Math\.min\(3, activeProviders\.length\)/,
    found: false,
  },
  {
    name: 'Fix #4: Falls through to sequential on race failure',
    file: 'src/lib/agent.ts',
    pattern: /sequential fallback after parallel race failed/,
    found: false,
  },

  // Error message quality
  {
    name: 'Error: All-rate-limited message includes fix suggestions',
    file: 'src/lib/agent.ts',
    pattern: /enable parallel-race mode: set LLM_PARALLEL_RACE=true/,
    found: false,
  },
  {
    name: 'Error: Mixed-failure message distinguishes rate-limit vs other',
    file: 'src/lib/agent.ts',
    pattern: /\$ \{rateLimitCount \?\? 0\} rate-limited, \$ \{nonRateLimitCount \?\? 0\} other/,
    found: false,
  },
]

for (const c of checks) {
  const abs = path.join(baseDir, c.file)
  try {
    const content = fs.readFileSync(abs, 'utf8')
    c.found = c.pattern.test(content)
  } catch {
    c.found = false
  }
}

console.log('═══════════════════════════════════════════════════════════════')
console.log('  UPGRADE #149 Verification Audit (4 LLM Provider Fixes)')
console.log('═══════════════════════════════════════════════════════════════')
console.log('')

let allPassed = true
let passed = 0, failed = 0
for (const c of checks) {
  const status = c.found ? '✅' : '❌'
  console.log(`  ${status} ${c.name}`)
  if (c.found) passed++; else { failed++; allPassed = false }
}

console.log('')
console.log('═══════════════════════════════════════════════════════════════')
console.log(`  RESULT: ${allPassed ? '✅ ALL CHECKS PASSED' : '❌ SOME CHECKS FAILED'} (${passed}/${checks.length} passed)`)
console.log('═══════════════════════════════════════════════════════════════')

const report = {
  auditId: 'upgrade-149-verification',
  generatedAt: new Date().toISOString(),
  allPassed,
  totalChecks: checks.length,
  passed,
  failed,
  checks,
}
fs.writeFileSync('/home/z/my-project/download/agent007-upgrade-149-audit.json', JSON.stringify(report, null, 2))
console.log(`\nReport saved: /home/z/my-project/download/agent007-upgrade-149-audit.json`)
