#!/usr/bin/env bun
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SCAN_ROOTS = ['src', 'instrumentation.ts']
const ALLOWED_FILES = new Set([
  'src/lib/runtime/vercel-background.ts',
  'src/lib/storage/vercel-blob.ts',
])
const IGNORED_SEGMENTS = new Set(['node_modules', '.git', '.next', 'coverage'])
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])

const BANNED_PATTERNS: Array<[string, RegExp]> = [
  ['Vercel URL environment variable', /\bVERCEL_URL\b/],
  ['Vercel deployment hostname', /https?:\/\/[^\s"'`]*vercel\.app/i],
  ['Vercel hosting package import', /@vercel\/(?:functions|blob|edge|node|og)/],
  ['Vercel hosting namespace', /\bprocess\.env\.VERCEL\b/],
  ['Vercel-specific public URL variable', /\bNEXT_PUBLIC_VERCEL_/],
]

function collectFiles(path: string): string[] {
  const absolute = join(ROOT, path)
  const entry = readdirSync(absolute, { withFileTypes: true })
  const files: string[] = []

  for (const item of entry) {
    const relativePath = join(path, item.name).replaceAll('\\', '/')
    if (IGNORED_SEGMENTS.has(item.name)) continue
    if (item.isDirectory()) {
      files.push(...collectFiles(relativePath))
      continue
    }
    const extension = relativePath.includes('.') ? `.${relativePath.split('.').pop()}` : ''
    if (SOURCE_EXTENSIONS.has(extension) && !ALLOWED_FILES.has(relativePath)) files.push(relativePath)
  }

  return files
}

const files = SCAN_ROOTS.flatMap((root) => root.endsWith('.ts') ? [root] : collectFiles(root))
const findings: string[] = []

for (const path of files) {
  const source = readFileSync(join(ROOT, path), 'utf8')
  for (const [label, pattern] of BANNED_PATTERNS) {
    if (pattern.test(source)) findings.push(`${path}: ${label}`)
  }
}

if (findings.length > 0) {
  console.error('Hosting Independence audit failed. Provider-specific coupling was found outside explicit adapters:')
  for (const finding of findings) console.error(`- ${finding}`)
  process.exit(1)
}

console.log(`Hosting Independence audit passed: ${files.length} host-neutral source files checked.`)
console.log(`Explicit provider adapters allowed: ${[...ALLOWED_FILES].join(', ')}`)
