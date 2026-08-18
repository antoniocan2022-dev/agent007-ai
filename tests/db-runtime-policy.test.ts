import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const dbSource = readFileSync('src/lib/db.ts', 'utf8')
const packageSource = readFileSync('package.json', 'utf8')
const vercelSource = readFileSync('vercel.json', 'utf8')


describe('production database runtime policy', () => {
  test('runtime client contains no request-time schema bootstrap', () => {
    expect(dbSource).not.toContain('CREATE TABLE IF NOT EXISTS')
    expect(dbSource).not.toContain('createTablesViaRawSQL')
    expect(dbSource).not.toContain('seedData()')
  })

  test('runtime client uses a conservative connection pool by default', () => {
    expect(dbSource).toContain("url.searchParams.set('connection_limit', '1')")
    expect(dbSource).toContain("url.searchParams.set('pool_timeout', '20')")
  })

  test('schema reconciliation is release-time only', () => {
    const pkg = JSON.parse(packageSource) as { scripts: Record<string, string> }
    expect(pkg.scripts['db:reconcile']).toBe('bun src/lib/reconcile-production-schema.ts')
    expect(pkg.scripts['db:bootstrap']).toBe('bun scripts/bootstrap-owner-data.ts')
    expect(vercelSource).toContain('AGENT007_RELEASE_SCHEMA_RECONCILE=1 bun run build')
  })
})
