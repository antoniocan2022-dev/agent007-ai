import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const dbSource = readFileSync('src/lib/db.ts', 'utf8')
const packageSource = readFileSync('package.json', 'utf8')
const vercelSource = readFileSync('vercel.json', 'utf8')
const vercelBuildSource = readFileSync('scripts/vercel-build.sh', 'utf8')

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

  test('serverless runtime reuses one Prisma client per warm function instance', () => {
    expect(dbSource).toContain('globalForPrisma.prisma ??')
    expect(dbSource).toContain('globalForPrisma.prisma = db')
    expect(dbSource).not.toContain("if (process.env.NODE_ENV !== 'production')")
  })

  test('schema reconciliation is release-time only and has one canonical build path', () => {
    const pkg = JSON.parse(packageSource) as { scripts: Record<string, string> }
    expect(pkg.scripts['db:reconcile']).toBe('bun src/lib/reconcile-production-schema.ts')
    expect(pkg.scripts['db:bootstrap']).toBe('bun scripts/bootstrap-owner-data.ts')
    expect(pkg.scripts.build).toContain('if [ "$AGENT007_RELEASE_SCHEMA_RECONCILE" = "1" ]; then bun run db:reconcile; fi')
    expect(vercelSource).toContain('"buildCommand": "bash scripts/vercel-build.sh"')
    expect(vercelBuildSource).toContain('export AGENT007_RELEASE_SCHEMA_RECONCILE=1')
    expect(vercelBuildSource).toContain('bun run build')
    expect(vercelBuildSource).not.toContain('bun run db:reconcile')
    expect(vercelBuildSource).not.toContain('AGENT007_RELEASE_SCHEMA_RECONCILE=1 bun run build')
  })
})
