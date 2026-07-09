/**
 * test-payment-accounts.ts — exercise the full PayPal + bank account lifecycle.
 *
 * Verifies:
 *   1. list_payment_accounts (manage action) — initially 0 accounts
 *   2. link_payment_account (PayPal) — adds a PayPal account
 *   3. list again — now 1 account
 *   4. Test the PayPal connection via /api/payment-accounts/test (no creds → friendly message)
 *   5. link_payment_account (bank) — adds a bank account
 *   6. List — now 2 accounts
 *   7. Test the bank connection (validates ABA checksum, reports pending verification)
 *   8. verify_bank_account (manage action) — marks as verified
 *   9. Test again — now fully verified
 *  10. unlink_payment_account (PayPal) — removes it
 *  11. unlink_payment_account (bank) — removes it
 *  12. Final list — back to 0 accounts
 *
 * Uses the same executeManageAction as Agent007 uses, so this is a true end-to-end test.
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
  // === 1. Initial state ===
  console.log('\n--- 1. list_payment_accounts (initial) ---')
  const initial = await executeManageAction('list_payment_accounts', {})
  assert(initial.ok === true, 'list_payment_accounts succeeds')
  const initialCount = initial.data?.count ?? 0
  console.log(`   Initial accounts: ${initialCount}`)

  // === 2. Link PayPal account ===
  console.log('\n--- 2. link_payment_account (PayPal) ---')
  const paypalEmail = `test-paypal-${Date.now()}@example.com`
  const linkPaypal = await executeManageAction('link_payment_account', {
    type: 'paypal',
    email: paypalEmail,
    // No client_id/client_secret — will test the "no creds" path
  })
  assert(linkPaypal.ok === true, `link_payment_account PayPal succeeds for ${paypalEmail}`)
  const paypalId = linkPaypal.data?.id
  assert(typeof paypalId === 'string', `PayPal account id returned (${paypalId})`)

  // === 3. List — should now have 1 account ===
  console.log('\n--- 3. list_payment_accounts (after PayPal) ---')
  const afterPaypal = await executeManageAction('list_payment_accounts', {})
  assert(afterPaypal.data?.count === initialCount + 1, `Account count incremented (${afterPaypal.data?.count})`)
  const paypalAccount = afterPaypal.data?.accounts?.find((a: any) => a.id === paypalId)
  assert(!!paypalAccount, 'PayPal account is in the list')
  assert(paypalAccount?.platform === 'paypal', 'Account platform is "paypal"')
  assert(paypalAccount?.email === paypalEmail, `Account email matches (${paypalAccount?.email})`)
  assert(paypalAccount?.connected === true, 'PayPal account is connected')

  // === 4. Test PayPal connection (via HTTP endpoint) ===
  console.log('\n--- 4. Test PayPal connection (no credentials) ---')
  const paypalTestRes = await fetch('http://localhost:3000/api/payment-accounts/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: paypalId }),
  })
  const paypalTest = await paypalTestRes.json()
  assert(paypalTestRes.ok, 'PayPal test endpoint returns 200')
  assert(paypalTest.provider === 'paypal', 'Test response has provider="paypal"')
  assert(paypalTest.ok === false, 'PayPal test fails (no credentials) — expected')
  assert(paypalTest.message.includes('Client ID'), 'Message mentions Client ID requirement')

  // === 5. Link bank account ===
  console.log('\n--- 5. link_payment_account (bank) ---')
  const linkBank = await executeManageAction('link_payment_account', {
    type: 'bank',
    account_holder: 'Antonio Test',
    bank_name: 'Test Bank',
    account_number: '123456789',
    routing_number: '021000021', // Valid Chase routing number (passes ABA checksum)
    account_type: 'checking',
    country: 'US',
    currency: 'USD',
  })
  assert(linkBank.ok === true, 'link_payment_account bank succeeds')
  const bankId = linkBank.data?.id
  assert(typeof bankId === 'string', `Bank account id returned (${bankId})`)
  assert(linkBank.data?.last4 === '6789', `Last 4 digits correct (${linkBank.data?.last4})`)

  // === 6. List — should now have 2 accounts ===
  console.log('\n--- 6. list_payment_accounts (after bank) ---')
  const afterBank = await executeManageAction('list_payment_accounts', {})
  assert(afterBank.data?.count === initialCount + 2, `Account count now ${initialCount + 2}`)
  const bankAccount = afterBank.data?.accounts?.find((a: any) => a.id === bankId)
  assert(!!bankAccount, 'Bank account is in the list')
  assert(bankAccount?.platform === 'bank', 'Account platform is "bank"')
  assert(bankAccount?.verificationStatus === 'pending', 'Bank verification status is "pending"')
  assert(bankAccount?.connected === false, 'Bank account is NOT connected (pending verification)')

  // === 7. Test bank connection (validates ABA checksum) ===
  console.log('\n--- 7. Test bank connection (pending verification) ---')
  const bankTestRes = await fetch('http://localhost:3000/api/payment-accounts/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: bankId }),
  })
  const bankTest = await bankTestRes.json()
  assert(bankTestRes.ok, 'Bank test endpoint returns 200')
  assert(bankTest.provider === 'bank', 'Test response has provider="bank"')
  assert(bankTest.ok === false, 'Bank test fails (pending verification) — expected')
  assert(bankTest.details?.routingValid === true, 'Routing number passes ABA checksum')
  assert(bankTest.details?.verificationStatus === 'pending', 'Verification status is pending')
  // Verify checks array has 6 entries
  assert(Array.isArray(bankTest.checks) && bankTest.checks.length === 6, 'Bank test returns 6 checks')

  // === 8. Verify bank account (manage action) ===
  console.log('\n--- 8. verify_bank_account ---')
  const verify = await executeManageAction('verify_bank_account', { id: bankId })
  assert(verify.ok === true, 'verify_bank_account succeeds')
  assert(verify.message.includes('verified'), 'Message confirms verification')

  // === 9. Test bank again — now fully verified ===
  console.log('\n--- 9. Test bank (after verification) ---')
  const bankTest2Res = await fetch('http://localhost:3000/api/payment-accounts/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: bankId }),
  })
  const bankTest2 = await bankTest2Res.json()
  assert(bankTest2.ok === true, 'Bank test now succeeds after verification')
  assert(bankTest2.details?.verificationStatus === 'verified', 'Verification status is "verified"')
  assert(bankTest2.message.includes('valid and verified'), 'Message confirms valid + verified')

  // === 10. Unlink PayPal ===
  console.log('\n--- 10. unlink_payment_account (PayPal) ---')
  const unlinkPaypal = await executeManageAction('unlink_payment_account', { id: paypalId })
  assert(unlinkPaypal.ok === true, 'unlink PayPal succeeds')

  // === 11. Unlink bank ===
  console.log('\n--- 11. unlink_payment_account (bank) ---')
  const unlinkBank = await executeManageAction('unlink_payment_account', { id: bankId })
  assert(unlinkBank.ok === true, 'unlink bank succeeds')

  // === 12. Final list — back to initial count ===
  console.log('\n--- 12. Final list ---')
  const final = await executeManageAction('list_payment_accounts', {})
  assert(final.data?.count === initialCount, `Final account count back to ${initialCount} (got ${final.data?.count})`)

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
