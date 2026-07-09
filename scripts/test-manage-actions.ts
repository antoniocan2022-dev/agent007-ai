/**
 * test-manage-actions.ts — exercise the new full-access manage actions.
 *
 * Verifies:
 *   1. list_users returns the user list
 *   2. create_user + edit_user + delete_user lifecycle works
 *   3. delete_conversation on a non-existent id returns proper error
 *   4. edit_schedule on non-existent id returns proper error
 *   5. clear_all_income without confirm="yes" fails safely
 *   6. export_data returns the full data structure
 *   7. Unknown action returns the updated supported-actions list
 */
import { executeManageAction } from '../src/lib/orchestrator'

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
  // === 1. list_users ===
  console.log('\n--- 1. list_users ---')
  const listRes = await executeManageAction('list_users', {})
  assert(listRes.ok === true, `list_users succeeds`)
  assert(Array.isArray(listRes.data?.users), 'list_users returns users array')
  assert(typeof listRes.data?.count === 'number', `list_users returns count (${listRes.data?.count})`)
  console.log(`   Found ${listRes.data?.count} user(s)`)

  // === 2. create_user + edit_user + delete_user lifecycle ===
  console.log('\n--- 2. create_user + edit_user + delete_user ---')
  const testEmail = `test-manage-${Date.now()}@example.com`
  const createRes = await executeManageAction('create_user', {
    email: testEmail,
    password: 'testpass123',
    name: 'Test Manage User',
  })
  assert(createRes.ok === true, `create_user succeeds for ${testEmail}`)
  const userId = createRes.data?.id
  assert(typeof userId === 'string', `create_user returns user id (${userId})`)

  if (userId) {
    const editRes = await executeManageAction('edit_user', {
      id: userId,
      name: 'Updated Name',
    })
    assert(editRes.ok === true, `edit_user succeeds`)
    assert(editRes.message.includes('updated'), 'edit_user message confirms update')

    const delRes = await executeManageAction('delete_user', { id: userId })
    assert(delRes.ok === true, `delete_user succeeds`)
    assert(delRes.message.includes('deleted'), 'delete_user message confirms deletion')
  }

  // === 3. delete_conversation on non-existent id ===
  console.log('\n--- 3. delete_conversation (non-existent) ---')
  const delConvRes = await executeManageAction('delete_conversation', { id: 'nonexistent-conv-id' })
  assert(delConvRes.ok === false, 'delete_conversation on non-existent id fails')
  assert(delConvRes.message.includes('not found'), 'delete_conversation returns "not found" message')

  // === 4. edit_schedule on non-existent id ===
  console.log('\n--- 4. edit_schedule (non-existent) ---')
  const editSchedRes = await executeManageAction('edit_schedule', { id: 'nonexistent-sched-id', name: 'Test' })
  assert(editSchedRes.ok === false, 'edit_schedule on non-existent id fails')

  // === 5. clear_all_income without confirm ===
  console.log('\n--- 5. clear_all_income (without confirm) ---')
  const clearRes = await executeManageAction('clear_all_income', {})
  assert(clearRes.ok === false, 'clear_all_income without confirm="yes" fails safely')
  assert(clearRes.message.includes('confirm'), 'clear_all_income mentions confirm requirement')

  // === 6. export_data ===
  console.log('\n--- 6. export_data ---')
  const exportRes = await executeManageAction('export_data', { format: 'json' })
  assert(exportRes.ok === true, 'export_data succeeds')
  assert(exportRes.data?.users !== undefined, 'export_data includes users')
  assert(exportRes.data?.conversations !== undefined, 'export_data includes conversations')
  assert(exportRes.data?.income !== undefined, 'export_data includes income')
  assert(exportRes.data?.schedules !== undefined, 'export_data includes schedules')
  assert(exportRes.data?.memories !== undefined, 'export_data includes memories')
  assert(exportRes.data?.subagents !== undefined, 'export_data includes subagents')
  assert(exportRes.data?.exportedAt !== undefined, 'export_data includes exportedAt timestamp')

  // === 7. Unknown action returns updated supported list ===
  console.log('\n--- 7. Unknown action ---')
  const unknownRes = await executeManageAction('nonexistent_action', {})
  assert(unknownRes.ok === false, 'Unknown action fails')
  assert(unknownRes.message.includes('list_users'), 'Error message includes list_users in supported actions')
  assert(unknownRes.message.includes('create_user'), 'Error message includes create_user')
  assert(unknownRes.message.includes('delete_user'), 'Error message includes delete_user')
  assert(unknownRes.message.includes('export_data'), 'Error message includes export_data')
  assert(unknownRes.message.includes('clear_all_income'), 'Error message includes clear_all_income')

  // === 8. delete_user on protected operator account ===
  console.log('\n--- 8. delete_user on protected operator ---')
  // First find the operator's id
  const opList = await executeManageAction('list_users', {})
  const operator = opList.data?.users?.find((u: any) => u.email === 'antonio.can2022@hotmail.com')
  if (operator) {
    const protectRes = await executeManageAction('delete_user', { id: operator.id })
    assert(protectRes.ok === false, 'delete_user on operator account fails')
    assert(protectRes.message.includes('cannot be deleted'), 'Operator account is protected')
  } else {
    console.log('   (skipped — operator not found)')
  }

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
