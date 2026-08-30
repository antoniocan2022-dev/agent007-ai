import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('deployment reality invariant', () => {
  test('API exposes exact Vercel deployment and release commit identity', () => {
    const route = readFileSync(join(process.cwd(), 'src/app/api/agent/route.ts'), 'utf8')
    expect(route).toContain('process.env.VERCEL_DEPLOYMENT_ID')
    expect(route).toContain('process.env.VERCEL_GIT_COMMIT_SHA')
    expect(route).toContain('releaseCommit')
    expect(route).toContain('deploymentId')
  })

  test('automatic Git deployment remains disabled', () => {
    const config = readFileSync(join(process.cwd(), 'vercel.json'), 'utf8')
    expect(config).toContain('"deploymentEnabled": false')
  })

  test('release documentation requires exact SHA equality before production verification', () => {
    const docs = readFileSync(join(process.cwd(), 'docs/CEO-CONVERSATIONAL-INTELLIGENCE.md'), 'utf8')
    expect(docs).toContain('exact GitHub `main` SHA equals the Vercel production SHA')
  })
})
