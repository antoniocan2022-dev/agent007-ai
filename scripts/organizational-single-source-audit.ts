import { readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const ROOT = process.cwd()
const CANONICAL_ORGANIZATION = 'src/lib/commercial-organization.ts'
const CANONICAL_SCOPE = 'src/lib/commercial-organization-scope.ts'
const CANONICAL_AUTHORITY = 'src/lib/architecture-control-plane.ts'
const CANONICAL_RUNTIME = 'src/lib/venture-operation-loop.ts'

const sourcePatterns: Array<{ name: string; pattern: RegExp; allow: Set<string> }> = [
  { name: 'duplicate LEADERS registry', pattern: /\b(?:export\s+)?(?:const|let|var)\s+LEADERS\s*(?:[:=])/i, allow: new Set([CANONICAL_ORGANIZATION]) },
  { name: 'duplicate SPECIALISTS registry', pattern: /\b(?:export\s+)?(?:const|let|var)\s+SPECIALISTS\s*(?:[:=])/i, allow: new Set([CANONICAL_ORGANIZATION]) },
  { name: 'duplicate directReports registry', pattern: /\b(?:export\s+)?(?:const|let|var)\s+directReports\s*(?:[:=])/i, allow: new Set([CANONICAL_ORGANIZATION]) },
  { name: 'duplicate ventureScope registry', pattern: /\b(?:export\s+)?(?:const|let|var)\s+ventureScope\s*(?:[:=])/i, allow: new Set([CANONICAL_SCOPE]) },
  { name: 'duplicate hierarchy registry', pattern: /\b(?:export\s+)?(?:const|let|var)\s+\w*HIERARCHY\w*\s*(?:[:=])/i, allow: new Set([CANONICAL_ORGANIZATION]) },
]

const fileNamePattern = /^(?:leaders|specialists|organization-(?:leaders|specialists)|agent-hierarchy|direct-reports|venture-scope)\.(?:ts|tsx)$/i
const enforcePattern = /(actorLevel\s*===\s*['"]CEO['"]|targetLevel\s*===\s*['"]VID['"]|actorLevel\s*===\s*['"]VID['"]|targetLevel\s*===\s*['"]LEADER['"])/

function isTest(file: string): boolean {
  return /(^|\/)tests?(?:\/|$)|\.test\.(?:ts|tsx)$/.test(file)
}

function sourceFiles(): string[] {
  const files: string[] = []
  const glob = new Bun.Glob('{src,scripts}/**/*.{ts,tsx}')
  for (const file of glob.scanSync({ cwd: ROOT, absolute: false })) {
    const full = resolve(ROOT, file)
    if (statSync(full).isFile()) files.push(file.replace(/\\/g, '/'))
  }
  return files.sort()
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
    const match = rule.pattern.exec(content)
    if (match) violations.push(`${file}:${lineNumber(content, match.index)}: ${rule.name}`)
  }

  if (file !== CANONICAL_AUTHORITY && file !== CANONICAL_RUNTIME && enforcePattern.test(content)) {
    violations.push(`${file}: hardcoded hierarchy enforcement belongs only to the canonical authority/runtime boundary`)
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
