import { readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = process.cwd()
const CANONICAL_ORGANIZATION = 'src/lib/commercial-organization.ts'
const CANONICAL_SCOPE = 'src/lib/commercial-organization-scope.ts'
const CANONICAL_AUTHORITY = 'src/lib/architecture-control-plane.ts'
const CANONICAL_RUNTIME = 'src/lib/venture-operation-loop.ts'

const sourcePatterns: Array<{ name: string; pattern: RegExp; allow: Set<string> }> = [
  // Deliberately require the legacy registry identifiers to be uppercase. Runtime
  // query parameters such as `leaders` are consumers, not organizational registries.
  { name: 'duplicate LEADERS registry', pattern: /\b(?:export\s+)?(?:const|let|var)\s+LEADERS\s*(?:[:=])/g, allow: new Set([CANONICAL_ORGANIZATION]) },
  { name: 'duplicate SPECIALISTS registry', pattern: /\b(?:export\s+)?(?:const|let|var)\s+SPECIALISTS\s*(?:[:=])/g, allow: new Set([CANONICAL_ORGANIZATION]) },
  { name: 'duplicate directReports registry', pattern: /\b(?:export\s+)?(?:const|let|var)\s+directReports\s*(?:[:=])/g, allow: new Set([CANONICAL_ORGANIZATION]) },
  { name: 'duplicate ventureScope registry', pattern: /\b(?:export\s+)?(?:const|let|var)\s+ventureScope\s*(?:[:=])/g, allow: new Set([CANONICAL_SCOPE]) },
  { name: 'duplicate hierarchy registry', pattern: /\b(?:export\s+)?(?:const|let|var)\s+\w*HIERARCHY\w*\s*(?:[:=])/g, allow: new Set([CANONICAL_ORGANIZATION]) },
]

const fileNamePattern = /^(?:leaders|specialists|organization-(?:leaders|specialists)|agent-hierarchy|direct-reports|venture-scope)\.(?:ts|tsx)$/i

// Detect executable hierarchy enforcement outside the canonical authority/runtime
// boundary, while ignoring ordinary API input variables, comments, and prose.
const enforcementPatterns: RegExp[] = [
  /if\s*\(\s*[^\n;{}]*\b(?:actor|request)\.actorLevel\s*={2,3}\s*['"](?:CEO|VID|LEADER|SPECIALIST)['"]/,
  /if\s*\(\s*[^\n;{}]*\b(?:target|request)\.targetLevel\s*={2,3}\s*['"](?:CEO|VID|LEADER|SPECIALIST)['"]/,
  /switch\s*\(\s*[^\n;{}]*\b(?:actor|request)\.actorLevel\s*\)/,
  /switch\s*\(\s*[^\n;{}]*\b(?:target|request)\.targetLevel\s*\)/,
]

function isTest(file: string): boolean {
  return /(^|\/)tests?(?:\/|$)|\.test\.(?:ts|tsx)$/.test(file)
}

function sourceFiles(): string[] {
  const files: string[] = []
  for (const pattern of ['src/**/*.ts', 'src/**/*.tsx', 'scripts/**/*.ts']) {
    const glob = new Bun.Glob(pattern)
    for (const file of glob.scanSync({ cwd: ROOT, absolute: false })) {
      const full = resolve(ROOT, file)
      if (statSync(full).isFile()) files.push(file.replace(/\\/g, '/'))
    }
  }
  return [...new Set(files)].sort()
}

function lineNumber(content: string, index: number): number {
  return content.slice(0, index).split('\n').length
}

const violations: string[] = []
for (const file of sourceFiles()) {
  if (isTest(file)) continue
  const content = readFileSync(join(ROOT, file), 'utf8')

  if (file !== CANONICAL_ORGANIZATION && fileNamePattern.test(file.split('/').pop() ?? '')) {
    violations.push(`${file}: legacy organizational registry filename is not allowed`)
  }

  for (const rule of sourcePatterns) {
    if (rule.allow.has(file)) continue
    rule.pattern.lastIndex = 0
    const match = rule.pattern.exec(content)
    if (match) violations.push(`${file}:${lineNumber(content, match.index)}: ${rule.name}`)
  }

  if (file !== CANONICAL_AUTHORITY && file !== CANONICAL_RUNTIME) {
    for (const pattern of enforcementPatterns) {
      pattern.lastIndex = 0
      const match = pattern.exec(content)
      if (match) {
        violations.push(`${file}:${lineNumber(content, match.index)}: hardcoded hierarchy enforcement belongs only to the canonical authority/runtime boundary`)
        break
      }
    }
  }
}

for (const required of [CANONICAL_ORGANIZATION, CANONICAL_SCOPE, CANONICAL_AUTHORITY, CANONICAL_RUNTIME]) {
  const full = resolve(ROOT, required)
  if (!statSync(full, { throwIfNoEntry: false })) violations.push(`${required}: canonical architecture file is missing`)
}

if (violations.length) {
  console.error('Phase 7 organizational single-source audit FAILED')
  for (const violation of violations) console.error(`- ${violation}`)
  process.exit(1)
}

console.log('Phase 7 organizational single-source audit PASSED: one canonical organization graph, one canonical venture-scope adapter, one authority boundary, and one Venture OS runtime consumer.')
