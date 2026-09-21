import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '..')
const read = (path: string) => readFileSync(join(root, path), 'utf8')

// Production incident (2026-09-21): POST /api/ventures/001 required an authenticated session but
// then called ensureVenture001() with no ownerUserId, discarding session.user.id. ensureVenture001
// only creates the relational Venture/BusinessUnit identity (via createOrGetVenture) when
// ownerUserId is truthy -- every one of its three branches gates that call behind `if (ownerUserId)`.
// So this endpoint could be hit any number of times by an authenticated owner and would still never
// create the relational row commercial-organization-scope.ts's businessKeyForVenture() requires --
// confirmed live: runVentureOperationCycle (the 24x7 heartbeat) failed with "Venture venture_001 has
// no canonical BusinessUnit scope" on every run, even after DATABASE_URL was correctly configured.
describe('Venture 001 bootstrap endpoint', () => {
  test('POST passes the authenticated session user id into ensureVenture001', () => {
    const source = read('src/app/api/ventures/001/route.ts')
    expect(source).toMatch(/ensureVenture001\(sessionResult\)/)
    expect(source).toContain("(session!.user as { id: string }).id")
    expect(source).toMatch(/return\s+userId\s*\|\|\s*NextResponse\.json/)
  })
})
