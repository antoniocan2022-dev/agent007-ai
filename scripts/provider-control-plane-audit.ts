import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOTS = ['src/lib', 'tests', 'scripts']
const TEXT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs'])
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

const runtimeConfigDefs = contents.filter(([, content]) => /export const PROVIDER_RUNTIME_CONFIG\s*=/.test(content)).map(([path]) => path)
if (runtimeConfigDefs.length !== 1 || runtimeConfigDefs[0] !== 'src/lib/provider-control-plane.ts') violations.push(`Expected exactly one canonical PROVIDER_RUNTIME_CONFIG in src/lib/provider-control-plane.ts; found ${runtimeConfigDefs.join(', ') || 'none'}`)

const modelMatrixDefs = contents.filter(([, content]) => /export const (GOVERNED_MODEL_PROFILES|MODEL_PROFILES)\s*=/.test(content)).map(([path, content]) => `${path}:${/export const GOVERNED_MODEL_PROFILES\s*=/.test(content) ? 'GOVERNED_MODEL_PROFILES' : 'MODEL_PROFILES'}`)
if (!modelMatrixDefs.some((entry) => entry.startsWith('src/lib/provider-control-plane.ts:GOVERNED_MODEL_PROFILES'))) violations.push('Canonical GOVERNED_MODEL_PROFILES is missing from provider-control-plane.ts')
for (const entry of modelMatrixDefs) if (!entry.startsWith('src/lib/provider-control-plane.ts:GOVERNED_MODEL_PROFILES') && entry.startsWith('src/lib/provider-runtime-v2.ts:')) violations.push(`Runtime must not define a second model matrix: ${entry}`)

for (const [path, content] of contents) {
  if (path === 'src/lib/provider-control-plane.ts') continue
  for (const stale of ['__providerDiscoveryDone', '__agent007ProviderModelCache']) {
    if (content.includes(stale)) violations.push(`Stale provider state marker ${stale} found in ${path}`)
  }
  if (content.includes('no governed model is available in the live provider catalog') && !path.endsWith('provider-control-plane.ts') && !path.includes('provider-control-plane.integration.test.ts')) {
    violations.push(`Old provider-catalog error text bypasses the control plane in ${path}`)
  }
  if (path.startsWith('src/lib/') && /defaultModel:\s*['"]gemini-3\.6-flash['"]/.test(content)) violations.push(`Gemini 3.6 must not remain the canonical default in ${path}`)
}

const controlPlane = readFileSync('src/lib/provider-control-plane.ts', 'utf8')
for (const required of ['gemini-3.7-flash', 'gemini-3.6-flash', "'BILLING'", "'RATE_LIMIT'", "'AUTHENTICATION'", 'resolveLiveCatalog', 'resolveGovernedModel', 'clearProviderCatalogCache']) {
  if (!controlPlane.includes(required)) violations.push(`Control-plane required invariant missing: ${required}`)
}

if (violations.length) {
  console.error('Provider control plane audit FAILED')
  for (const violation of violations) console.error(`- ${violation}`)
  process.exit(1)
}

console.log(`Provider control plane audit PASSED: ${files.length} source/test files scanned`)
