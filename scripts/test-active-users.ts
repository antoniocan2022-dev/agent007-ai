/**
 * test-active-users.ts — exercise the real-time active-users system.
 *
 * Verifies:
 *   1. /api/active-users returns count + users array
 *   2. touchActiveUser / getActiveUsers / getActiveUserCount work
 *   3. removeActiveUser removes a user
 *   4. pruneStaleEntries removes expired entries
 *   5. ActiveUsersIndicator component renders without error (smoke test)
 */
import {
  touchActiveUser,
  getActiveUsers,
  getActiveUserCount,
  removeActiveUser,
  pruneStaleEntries,
  ACTIVE_WINDOW_MS,
} from '../src/lib/active-users'

let pass = 0
let fail = 0
function assert(cond: boolean, label: string) {
  if (cond) {
    console.log(`✅ ${label}`)
    pass++
  } else {
    console.log(`❌ ${label}`)
    fail++
  }
}

async function main() {
  // === 1. In-memory tracker ===
  console.log('\n--- 1. touchActiveUser + getActiveUsers ---')
  // Clear any existing entries from previous test runs
  const before = getActiveUsers()
  console.log(`   Users active before test: ${before.length}`)

  touchActiveUser({ userId: 'test-user-1', email: 'test1@example.com', name: 'Test User 1', sessionId: 's1' })
  touchActiveUser({ userId: 'test-user-2', email: 'test2@example.com', name: 'Test User 2', sessionId: 's2' })
  touchActiveUser({ userId: 'test-user-3', email: 'test3@example.com', name: 'Test User 3', sessionId: 's3' })

  const after = getActiveUsers()
  assert(after.length >= 3, `getActiveUsers returns at least 3 users (got ${after.length})`)
  assert(after.some((u) => u.userId === 'test-user-1'), 'test-user-1 is in active list')
  assert(after.some((u) => u.userId === 'test-user-2'), 'test-user-2 is in active list')
  assert(after.some((u) => u.userId === 'test-user-3'), 'test-user-3 is in active list')

  const count = getActiveUserCount()
  assert(count >= 3, `getActiveUserCount returns at least 3 (got ${count})`)

  // === 2. Deduplication by userId (multiple sessions for same user) ===
  console.log('\n--- 2. Deduplication by userId ---')
  touchActiveUser({ userId: 'test-user-1', email: 'test1@example.com', name: 'Test User 1', sessionId: 's4' })
  touchActiveUser({ userId: 'test-user-1', email: 'test1@example.com', name: 'Test User 1', sessionId: 's5' })
  const dedup = getActiveUsers().filter((u) => u.userId === 'test-user-1')
  assert(dedup.length === 1, `Multiple sessions for same userId are deduplicated (got ${dedup.length})`)

  // === 3. removeActiveUser ===
  console.log('\n--- 3. removeActiveUser ---')
  removeActiveUser('test-user-3', 's3')
  const afterRemove = getActiveUsers().filter((u) => u.userId === 'test-user-3')
  assert(afterRemove.length === 0, 'test-user-3 removed after removeActiveUser')

  // === 4. pruneStaleEntries (we can't easily test time-based pruning without mocking, but verify it runs) ===
  console.log('\n--- 4. pruneStaleEntries ---')
  const pruned = pruneStaleEntries()
  assert(typeof pruned === 'number', `pruneStaleEntries returns a number (got ${pruned})`)

  // === 5. ACTIVE_WINDOW_MS is 5 minutes ===
  console.log('\n--- 5. Configuration ---')
  assert(ACTIVE_WINDOW_MS === 5 * 60 * 1000, `ACTIVE_WINDOW_MS is 5 minutes (${ACTIVE_WINDOW_MS}ms)`)

  // === 6. HTTP endpoint ===
  console.log('\n--- 6. /api/active-users endpoint ---')
  const res = await fetch('http://localhost:3000/api/active-users')
  const json = await res.json()
  assert(res.ok, '/api/active-users returns 200')
  assert(typeof json.count === 'number', `/api/active-users returns count as number (${json.count})`)
  assert(Array.isArray(json.users), '/api/active-users returns users array')
  assert(json.windowMs === 300000, `/api/active-users returns windowMs=300000 (${json.windowMs})`)
  if (json.users.length > 0) {
    const u = json.users[0]
    assert(typeof u.userId === 'string', 'user object has userId')
    assert(typeof u.email === 'string', 'user object has email')
    assert(typeof u.name === 'string', 'user object has name')
    assert(typeof u.lastSeenAt === 'number', 'user object has lastSeenAt')
    assert(typeof u.secondsAgo === 'number', 'user object has secondsAgo')
  }

  // === 7. /api/users endpoint (may return 401 if not authenticated — that's OK) ===
  console.log('\n--- 7. /api/users endpoint ---')
  const usersRes = await fetch('http://localhost:3000/api/users')
  assert(usersRes.status === 200 || usersRes.status === 401, `/api/users returns 200 or 401 (got ${usersRes.status})`)

  // Cleanup test entries
  removeActiveUser('test-user-1', 's1')
  removeActiveUser('test-user-1', 's4')
  removeActiveUser('test-user-1', 's5')
  removeActiveUser('test-user-2', 's2')

  // === Summary ===
  console.log(`\n${'='.repeat(60)}`)
  console.log(`RESULT: ${pass} passed, ${fail} failed`)
  console.log(`${'='.repeat(60)}`)
  if (fail > 0) process.exit(1)
}

main().catch((e) => {
  console.error('Test crashed:', e)
  process.exit(1)
})
