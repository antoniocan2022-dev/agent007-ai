import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('system audit contract', () => {
  const routePath = resolve(process.cwd(), 'src/app/api/system/audit/route.ts')

  test('does not advertise removed force-reset endpoints and includes canonical AI telemetry', () => {
    const source = readFileSync(routePath, 'utf8')
    expect(source).toContain("getCanonicalProviderTelemetry")
    expect(source).toContain("'/api/health'")
    expect(source).toContain("'/api/system/manifest'")
    expect(source).toContain("'/api/system/capabilities'")
    expect(source).not.toContain("'/api/auth/force-reset'")
    expect(source).not.toContain("name: 'Force-reset endpoint'")
    expect(source).toContain("report.ai.status === 'fail'")
  })
})
