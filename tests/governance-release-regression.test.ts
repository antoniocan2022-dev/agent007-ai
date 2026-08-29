import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dir, '..')
const read = (relative: string) => readFileSync(path.join(root, relative), 'utf8')
const route = read('src/app/api/agent/route.ts')
const composer = read('src/lib/ceo-context-composer.ts')
const releaseWorkflow = read('.github/workflows/production-release-watchdog.yml')
const vercel = JSON.parse(read('vercel.json')) as { git?: { deploymentEnabled?: boolean } }
const manifestGenerator = read('scripts/build-release-integrity-manifest.ts')

describe('governance release regression corpus', () => {
  test('context boundary cannot regress to route-level message assembly', () => {
    expect(route).toContain('composeCeoContext({')
    expect(route).toContain('messages: composed.messages')
    expect(route).toContain('messages: composedOperational.messages')
    expect(route).not.toMatch(/messages:\s*\[\s*\{\s*role:\s*['\"](?:system|user|assistant)['\"]/)
    expect(route).not.toMatch(/messages:\s*\[\.\.\.\s*(?:baseOperationalContext|composedOperational)\.messages/)
    expect(composer).toContain('export function buildCeoContextModules(')
    expect(composer).toContain('EXECUTION CONTEXT')
  })

  test('production deployment has one canonical mutation path and manual authorization', () => {
    expect(vercel.git?.deploymentEnabled ?? false).toBe(false)
    expect((releaseWorkflow.match(/vercel@[^\s]+ deploy --prod/g) ?? []).length).toBe(1)
    expect(releaseWorkflow).toContain("inputs.authorization == 'DEPLOY_AGENT007_MAIN'")
    expect(releaseWorkflow).toContain('test "$source_sha" = "$main_sha"')
    expect(releaseWorkflow).toContain('environment: production')
  })

  test('release integrity artifact captures one exact SHA chain and critical bytes', () => {
    expect(manifestGenerator).toContain('authorizedSha: releaseSha')
    expect(manifestGenerator).toContain('certifiedSha: releaseSha')
    expect(manifestGenerator).toContain('currentMainSha: mainSha')
    expect(manifestGenerator).toContain('gitBlobSha: blobSha(relative)')
    expect(manifestGenerator).toContain('createHash(\'sha256\').update(bytes).digest(\'hex\')')
    expect(manifestGenerator).toContain('byteLength: bytes.byteLength')
  })

  test('production deployment marker cannot be mistaken for current source state', () => {
    expect(releaseWorkflow).toContain('pointer_sha="$(git rev-parse HEAD)"')
    expect(releaseWorkflow).toContain('main_sha="$(git ls-remote origin refs/heads/main | awk')
    expect(releaseWorkflow).toContain('test "$pointer_sha" = "$main_sha"')
    expect(releaseWorkflow).toContain('git fetch origin "$RELEASE_SHA" --depth=1')
    expect(releaseWorkflow).toContain('git checkout --detach "$RELEASE_SHA"')
  })
})
