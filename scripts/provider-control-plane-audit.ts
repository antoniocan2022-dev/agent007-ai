import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOTS = ['src/lib', 'tests', 'scripts']
const TEXT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs'])
const AUDIT_FILE = 'scripts/provider-control-plane-audit.ts'
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

const runtimeConfigPattern = /export const PROVIDER_RUNTIME_CONFIG\s*(?::[^=]+)?=/
const governedModelPattern = /export const GOVERNED_MODEL_PROFILES\s*(?::[^=]+)?=/
const legacyModelPattern = /export const MODEL_PROFILES\s*(?::[^=]+)?=/

const runtimeConfigDefs = contents.filter(([, content]) => runtimeConfigPattern.test(content)).map(([path]) => path)
if (runtimeConfigDefs.length !== 1 || runtimeConfigDefs[0] !== 'src/lib/provider-control-plane.ts') {
  violations.push(`Expected exactly one canonical PROVIDER_RUNTIME_CONFIG in src/lib/provider-control-plane.ts; found ${runtimeConfigDefs.join(', ') || 'none'}`)
}

const canonicalModelDefs = contents.filter(([, content]) => governedModelPattern.test(content)).map(([path]) => path)
if (canonicalModelDefs.length !== 1 || canonicalModelDefs[0] !== 'src/lib/provider-control-plane.ts') {
  violations.push(`Expected exactly one canonical GOVERNED_MODEL_PROFILES in src/lib/provider-control-plane.ts; found ${canonicalModelDefs.join(', ') || 'none'}`)
}

for (const [path, content] of contents) {
  if (legacyModelPattern.test(content)) {
    const isApprovedCompatibilityAlias = path === 'src/lib/model-intelligence.ts' && /export const MODEL_PROFILES\s*:\s*readonly GovernedModelProfile\[\]\s*=\s*GOVERNED_MODEL_PROFILES/.test(content)
    if (!isApprovedCompatibilityAlias) violations.push(`Duplicate or legacy provider model matrix found: ${path}`)
  }
}

const staleDiscoveryMarker = ['__providerDiscovery', 'Done'].join('')
const staleCacheMarker = ['__agent007ProviderModel', 'Cache'].join('')
const oldCatalogError = ['no governed model is available in the live provider', ' catalog'].join('')

for (const [path, content] of contents) {
  if (path === 'src/lib/provider-control-plane.ts' || path === AUDIT_FILE) continue
  if (content.includes(staleDiscoveryMarker)) violations.push(`Stale provider discovery state marker found in ${path}`)
  if (content.includes(staleCacheMarker)) violations.push(`Stale provider model-cache state marker found in ${path}`)
  if (content.includes(oldCatalogError) && !path.includes('provider-control-plane.integration.test.ts')) {
    violations.push(`Old provider-catalog error text bypasses the control plane in ${path}`)
  }
  if (path.startsWith('src/lib/') && /defaultModel:\s*['\"]gemini-3\.6-flash['\"]/.test(content)) {
    violations.push(`Gemini 3.6 must not remain the canonical default in ${path}`)
  }
}

const controlPlane = readFileSync('src/lib/provider-control-plane.ts', 'utf8')
for (const required of [
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  "'BILLING'",
  "'RATE_LIMIT'",
  "'AUTHENTICATION'",
  'resolveLiveCatalog',
  'resolveGovernedModel',
  'clearProviderCatalogCache',
]) {
  if (!controlPlane.includes(required)) violations.push(`Control-plane required invariant missing: ${required}`)
}

if (violations.length) {
  console.error('Provider control plane audit FAILED')
  for (const violation of violations) console.error(`- ${violation}`)
  process.exit(1)
}

console.log(`Provider control plane audit PASSED: ${files.length} source/test files scanned`)
