import { dispatchTool, type ToolContext } from '../src/lib/tools'

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { console.log(`✅ ${label}`); pass++ }
  else { console.log(`❌ ${label}`); fail++ }
}
const ctx: ToolContext = { attachments: [], language: 'en' }

async function main() {
  const BASE = 'http://localhost:3000'

  // === 1. Bank Accounts — multiple ===
  console.log('\n--- 1. Bank Accounts (multiple) ---')
  // Add first bank account
  let res = await fetch(`${BASE}/api/bank-accounts`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountHolder: 'Antonio Test', bankName: 'Chase', accountNumber: '123456789', routingNumber: '021000021', accountType: 'checking', label: 'Chase Checking' }),
  })
  let data = await res.json()
  assert(data.ok === true, 'Add first bank account succeeds')
  assert(data.totalAccounts === 1, `First account is #1 (got ${data.totalAccounts})`)
  const bank1Id = data.account.id

  // Add second bank account
  res = await fetch(`${BASE}/api/bank-accounts`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountHolder: 'Antonio Test', bankName: 'TD Bank', accountNumber: '987654321', routingNumber: '021000021', accountType: 'savings', label: 'TD Savings' }),
  })
  data = await res.json()
  assert(data.ok === true, 'Add second bank account succeeds')
  assert(data.totalAccounts === 2, `Second account makes total 2 (got ${data.totalAccounts})`)

  // List accounts
  res = await fetch(`${BASE}/api/bank-accounts`)
  data = await res.json()
  assert(data.count === 2, `List shows 2 accounts (got ${data.count})`)
  assert(data.accounts[0].bankName === 'Chase' || data.accounts[1].bankName === 'Chase', 'Chase account present')
  assert(data.accounts[0].bankName === 'TD Bank' || data.accounts[1].bankName === 'TD Bank', 'TD Bank account present')

  // ABA checksum validation (invalid routing should fail)
  res = await fetch(`${BASE}/api/bank-accounts`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountHolder: 'Test', bankName: 'Bad', accountNumber: '123456789', routingNumber: '123456789' }),
  })
  data = await res.json()
  assert(res.status === 400, 'Invalid routing number rejected')
  assert(data.error.includes('ABA'), 'ABA checksum error mentioned')

  // Set primary
  res = await fetch(`${BASE}/api/bank-accounts/${bank1Id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isPrimary: true }) })
  data = await res.json()
  assert(data.ok === true, 'Set primary succeeds')

  // Verify account
  res = await fetch(`${BASE}/api/bank-accounts/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: bank1Id, amount1: 0.32, amount2: 0.45 }) })
  data = await res.json()
  assert(data.ok === true, 'Verify bank account succeeds')

  // === 2. PayPal Accounts — multiple ===
  console.log('\n--- 2. PayPal Accounts (multiple) ---')
  res = await fetch(`${BASE}/api/paypal-accounts`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'test1@example.com', clientId: 'client1', clientSecret: 'secret1' }),
  })
  data = await res.json()
  assert(data.ok === true, 'Add first PayPal succeeds')
  assert(data.totalAccounts === 1, `First PayPal #1 (got ${data.totalAccounts})`)

  res = await fetch(`${BASE}/api/paypal-accounts`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'test2@example.com' }),
  })
  data = await res.json()
  assert(data.ok === true, 'Add second PayPal succeeds')
  assert(data.totalAccounts === 2, `Second PayPal makes 2 (got ${data.totalAccounts})`)

  res = await fetch(`${BASE}/api/paypal-accounts`)
  data = await res.json()
  assert(data.count === 2, `List shows 2 PayPal accounts (got ${data.count})`)

  // === 3. Two-Factor Authentication ===
  console.log('\n--- 3. Two-Factor Authentication ---')
  // Setup Google Authenticator
  res = await fetch(`${BASE}/api/2fa/setup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method: 'google_authenticator' }) })
  data = await res.json()
  assert(data.ok === true, '2FA setup (Google Auth) succeeds')
  assert(!!data.qrCode, 'QR code generated')
  assert(Array.isArray(data.backupCodes) && data.backupCodes.length === 8, '8 backup codes generated')
  const configId = data.configId

  // Verify with wrong code (should fail)
  res = await fetch(`${BASE}/api/2fa/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ configId, code: '000000' }) })
  data = await res.json()
  assert(res.status === 400, 'Wrong code rejected')
  assert(data.error.includes('Invalid'), 'Invalid code error')

  // Setup SMS
  res = await fetch(`${BASE}/api/2fa/setup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method: 'sms', phoneNumber: '14165551234' }) })
  data = await res.json()
  assert(data.ok === true, '2FA setup (SMS) succeeds')
  assert(!!data.verificationCode, 'Verification code generated for SMS')
  const smsConfigId = data.configId
  const smsCode = data.verificationCode

  // Verify SMS with correct code
  res = await fetch(`${BASE}/api/2fa/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ configId: smsConfigId, code: smsCode }) })
  data = await res.json()
  assert(data.ok === true, 'SMS 2FA verified + enabled')

  // Check status
  res = await fetch(`${BASE}/api/2fa/status`)
  data = await res.json()
  assert(data.enabled === true, '2FA status shows enabled')
  assert(data.methods.length >= 1, `At least 1 method active (got ${data.methods.length})`)
  assert(data.methods[0].method === 'sms', 'SMS method is active')

  // === 4. Audit Log — permanent ===
  console.log('\n--- 4. Audit Log (permanent, no delete) ---')
  res = await fetch(`${BASE}/api/audit-log?limit=50`)
  data = await res.json()
  assert(data.permanent === true, 'Audit log marked permanent')
  assert(data.count > 0, `Audit log has entries (got ${data.count})`)
  assert(data.entries.some((e: any) => e.action === 'create' && e.entity === 'bank_account'), 'Bank account creation logged')
  assert(data.entries.some((e: any) => e.action === 'create' && e.entity === 'paypal_account'), 'PayPal creation logged')
  assert(data.entries.some((e: any) => e.action === '2fa_enable' || e.action === '2fa_setup'), '2FA actions logged')

  // Verify NO delete endpoint exists
  res = await fetch(`${BASE}/api/audit-log`, { method: 'DELETE' })
  assert(res.status === 405, 'DELETE on audit-log returns 405 Method Not Allowed (no delete endpoint)')

  // Filter by entity
  res = await fetch(`${BASE}/api/audit-log?entity=bank_account&limit=10`)
  data = await res.json()
  assert(data.entries.every((e: any) => e.entity === 'bank_account'), 'Entity filter works')

  // === 5. Cleanup ===
  console.log('\n--- 5. Cleanup ---')
  // Delete bank accounts (should be logged in audit)
  res = await fetch(`${BASE}/api/bank-accounts`)
  data = await res.json()
  for (const a of data.accounts) {
    await fetch(`${BASE}/api/bank-accounts/${a.id}`, { method: 'DELETE' })
  }
  // Delete PayPal accounts
  res = await fetch(`${BASE}/api/paypal-accounts`)
  data = await res.json()
  for (const a of data.accounts) {
    await fetch(`${BASE}/api/paypal-accounts/${a.id}`, { method: 'DELETE' })
  }
  // Disable 2FA
  res = await fetch(`${BASE}/api/2fa/status`)
  data = await res.json()
  for (const m of data.methods) {
    await fetch(`${BASE}/api/2fa/disable`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ configId: m.id }) })
  }

  // Verify deletion was logged (audit log should still have the delete entries)
  res = await fetch(`${BASE}/api/audit-log?limit=100`)
  data = await res.json()
  assert(data.entries.some((e: any) => e.action === 'delete' && e.entity === 'bank_account'), 'Bank deletion logged')
  assert(data.entries.some((e: any) => e.action === 'delete' && e.entity === 'paypal_account'), 'PayPal deletion logged')
  assert(data.entries.some((e: any) => e.action === '2fa_disable'), '2FA disable logged')

  console.log(`\n${'='.repeat(60)}\nRESULT: ${pass} passed, ${fail} failed\n${'='.repeat(60)}`)
  if (fail > 0) process.exit(1)
}
main().catch(e => { console.error('Crashed:', e); process.exit(1) })
