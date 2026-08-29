import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dir, '..')
const CRITICAL_FILES = [
  '.github/workflows/production-release-watchdog.yml',
  'src/app/api/agent/route.ts',
  'src/lib/ceo-context-composer.ts',
  'src/lib/ceo-cognitive-lifecycle.ts',
  'src/lib/ceo-response-quality-gate.ts',
  'src/lib/ceo-failure-reason.ts',
  '.release/production-deploy.json',
]

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()
}

function blobSha(relative: string): string {
  return git('rev-parse', `HEAD:${relative}`)
}

const releaseSha = git('rev-parse', 'HEAD')
const mainSha = git('ls-remote', 'origin', 'refs/heads/main').split(/\s+/)[0] || releaseSha
if (!/^[0-9a-f]{40}$/.test(releaseSha) || !/^[0-9a-f]{40}$/.test(mainSha)) throw new Error('Cannot resolve canonical main SHA.')
if (releaseSha !== mainSha) throw new Error(`Release checkout is not current main: ${releaseSha} != ${mainSha}`)

const manifest = {
  schemaVersion: 1,
  status: 'RELEASE_INTEGRITY_MANIFEST',
  generatedAt: new Date().toISOString(),
  repository: 'antoniocan2022-dev/agent007-ai',
  ref: 'main',
  releaseSha,
  currentMainSha: mainSha,
  authorizedSha: releaseSha,
  certifiedSha: releaseSha,
  deploymentSha: process.env.DEPLOYMENT_SHA || null,
  deploymentId: process.env.DEPLOYMENT_ID || null,
  target: 'production',
  authorization: 'DEPLOY_AGENT007_MAIN',
  criticalFiles: Object.fromEntries(CRITICAL_FILES.map((relative) => {
    const bytes = readFileSync(path.join(ROOT, relative))
    return [relative, {
      gitBlobSha: blobSha(relative),
      sha256: createHash('sha256').update(bytes).digest('hex'),
      byteLength: bytes.byteLength,
    }]
  })),
}

const outputPath = process.env.OUTPUT_PATH
  ? path.resolve(ROOT, process.env.OUTPUT_PATH)
  : path.join(ROOT, 'release-integrity-manifest.json')
writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
console.log(outputPath)
