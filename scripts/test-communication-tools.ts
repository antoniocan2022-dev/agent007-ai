/**
 * test-communication-tools.ts — exercise the 3 new direct-communication tools.
 *
 * Tests:
 *   1. send_communication (tries to send — will fail if no channel configured, but should return a proper error)
 *   2. check_inbound_commands (should return empty list or list of commands)
 *   3. execute_inbound_command (creates a fake inbound command, then executes it)
 *   4. Full inbound → execute → reply cycle
 */
import { dispatchTool, type ToolContext } from '../src/lib/tools'

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

const ctx: ToolContext = { attachments: [], language: 'en' }

async function main() {
  // === 1. check_inbound_commands (initial — should be empty or have old commands) ===
  console.log('\n--- 1. check_inbound_commands (initial) ---')
  const check1 = await dispatchTool('check_inbound_commands', { status: 'pending', limit: 10 }, ctx)
  assert(check1.ok === true, 'check_inbound_commands succeeds')
  assert(check1.result.includes('Inbound Commands') || check1.result.includes('No pending'), `Returns proper response (${check1.preview})`)

  // === 2. Simulate an inbound command via the /api/commands/receive endpoint ===
  console.log('\n--- 2. Simulate inbound WhatsApp command ---')
  const recvRes = await fetch('http://localhost:3000/api/commands/receive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: 'whatsapp',
      fromNumber: '14165551234',
      command: 'Log $75 income from Test Source — functional test',
    }),
  })
  const recvData = await recvRes.json()
  assert(recvRes.ok, '/api/commands/receive returns 200')
  assert(recvData.ok === true, `Inbound command received (${recvData.message})`)
  const commandId = recvData.commandId
  assert(typeof commandId === 'string', `Command ID returned (${commandId})`)

  // === 3. check_inbound_commands again — should now show the new command ===
  console.log('\n--- 3. check_inbound_commands (after inbound) ---')
  const check2 = await dispatchTool('check_inbound_commands', { status: 'pending', limit: 10 }, ctx)
  assert(check2.ok === true, 'check_inbound_commands succeeds')
  assert(check2.result.includes(commandId), `New command ${commandId} is in the pending list`)
  assert(check2.result.includes('Log $75 income'), 'Command text is in the response')
  assert(check2.result.includes('WHATSAPP'), 'Source channel (WHATSAPP) is in the response')
  assert(check2.result.includes('14165551234'), 'Sender number is in the response')

  // === 4. execute_inbound_command — mark as completed with a reply ===
  console.log('\n--- 4. execute_inbound_command ---')
  const exec = await dispatchTool('execute_inbound_command', {
    command_id: commandId,
    reply_message: '✅ Done! Logged $75 income from Test Source. Daily total: $75.',
  }, ctx)
  assert(exec.ok === true, 'execute_inbound_command succeeds')
  assert(exec.result.includes('executed'), 'Result confirms execution')
  assert(exec.result.includes('whatsapp') || exec.result.includes('WhatsApp') || exec.result.includes('WHATSAPP'), 'Result mentions the source channel')

  // === 5. check_inbound_commands — pending should no longer include the executed command ===
  console.log('\n--- 5. check_inbound_commands (after execute) ---')
  const check3 = await dispatchTool('check_inbound_commands', { status: 'pending', limit: 10 }, ctx)
  assert(check3.ok === true, 'check_inbound_commands succeeds')
  assert(!check3.result.includes(commandId), `Executed command ${commandId} is no longer pending`)

  // === 6. check_inbound_commands with status=all — should show the completed command ===
  console.log('\n--- 6. check_inbound_commands (status=all) ---')
  const check4 = await dispatchTool('check_inbound_commands', { status: 'all', limit: 50 }, ctx)
  assert(check4.ok === true, 'check_inbound_commands (all) succeeds')
  assert(check4.result.includes(commandId), `Completed command ${commandId} appears in status=all`)

  // === 7. send_communication — try to send via WhatsApp (may fail if not configured) ===
  console.log('\n--- 7. send_communication ---')
  const send = await dispatchTool('send_communication', {
    channel: 'whatsapp',
    message: '🤖 Test from Agent007: Communication tools are working!',
  }, ctx)
  // This may succeed or fail depending on whether WhatsApp is configured.
  // We just verify the tool runs and returns a structured response.
  assert(typeof send.ok === 'boolean', 'send_communication returns a structured response')
  assert(send.result.length > 0, 'send_communication returns a non-empty result')
  if (send.ok) {
    console.log('   (WhatsApp is configured — message sent successfully)')
  } else {
    console.log('   (WhatsApp not configured — expected failure with helpful message)')
    assert(send.result.includes('configured') || send.result.includes('Settings'), 'Failure message points to Settings')
  }

  // === 8. execute_inbound_command with invalid ID ===
  console.log('\n--- 8. execute_inbound_command (invalid ID) ---')
  const execBad = await dispatchTool('execute_inbound_command', {
    command_id: 'nonexistent-id',
    reply_message: 'test',
  }, ctx)
  assert(execBad.ok === false, 'execute_inbound_command with invalid ID fails')
  assert(execBad.result.includes('not found') || execBad.result.includes('Failed'), 'Failure message is helpful')

  // === 9. check_inbound_commands with invalid status (should default to pending) ===
  console.log('\n--- 9. check_inbound_commands (status=all shows history) ---')
  const check5 = await dispatchTool('check_inbound_commands', { status: 'completed', limit: 5 }, ctx)
  assert(check5.ok === true, 'check_inbound_commands (completed) succeeds')

  // Cleanup: delete the test command
  try {
    const { db } = await import('../src/lib/db')
    await db.incomingCommand.deleteMany({ where: { id: commandId } })
    console.log('\n   (Cleaned up test command)')
  } catch {}

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
