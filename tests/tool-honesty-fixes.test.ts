import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// real-integrations-v2.ts imports from './tools', which transitively pulls in a next-auth import chain
// that isn't installed in this sandbox (a pre-existing, unrelated limitation -- confirmed no other test
// in this codebase imports this file either). Verified via direct `bun -e` execution during development
// that toolAffiliateTracker/toolPayPalAPI behave as asserted below; these tests check the source
// directly so a regression back to the fabricated/fake behavior is still caught in CI.
const ROOT = join(import.meta.dir, '..')
const source = readFileSync(join(ROOT, 'src/lib/real-integrations-v2.ts'), 'utf-8')

describe('tool-registry honesty fixes', () => {
  test('the affiliate tracker no longer returns a hardcoded fabricated stats string', () => {
    expect(source).not.toContain('8 programs, $1,840/mo')
    expect(source).not.toContain("8 programs tracked, $1,840/mo revenue, 138 sales")
  })

  test('the affiliate tracker stats action queries real persisted IncomeEntry rows instead of returning a canned narrative', () => {
    expect(source).toContain("db.incomeEntry.findMany({ where: { source: { startsWith: 'affiliate:' }")
    expect(source).toContain('No affiliate activity tracked yet.')
  })

  test('track_conversion persists a real IncomeEntry instead of returning an unpersisted canned confirmation', () => {
    expect(source).toContain('db.incomeEntry.create({ data: { amount: commission')
  })

  test('automate_payout delegates to the real PayPal payout implementation instead of claiming a payout that never happens', () => {
    const automatePayoutBlock = source.slice(source.indexOf("if (action === 'automate_payout')"))
    expect(automatePayoutBlock.slice(0, 400)).toContain("toolPayPalAPI({ action: 'payout'")
  })

  test('PayPal tool actually calls the PayPal REST API instead of only checking that env vars are set', () => {
    // The old implementation's entire body was one line returning a canned "ready" message.
    expect(source).not.toContain("'PayPal REST API ready. Use action=balance, create_order, payout, list_transactions.'")
    expect(source).toContain('async function getPayPalAccessToken(')
    expect(source).toContain("await fetch(`${base}/v1/oauth2/token`")
  })

  test('PayPal balance/create_order/payout/list_transactions actions are all real, against real PayPal REST endpoints', () => {
    expect(source).toContain("await fetch(`${base}/v1/reporting/balances`")
    expect(source).toContain("await fetch(`${base}/v2/checkout/orders`")
    expect(source).toContain("await fetch(`${base}/v1/payments/payouts`")
    expect(source).toContain("await fetch(`${base}/v1/reporting/transactions")
  })

  test('PayPal defaults to the sandbox environment unless PAYPAL_ENV=live is explicitly set -- fails safely toward test money, not real money', () => {
    expect(source).toContain("process.env.PAYPAL_ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com'")
  })
})

describe('PayPal credential storage honesty fix', () => {
  const routeSource = readFileSync(join(ROOT, 'src/app/api/paypal-accounts/route.ts'), 'utf-8')

  test('no longer stores credentials with base64-plus-hardcoded-public-salt "obfuscation"', () => {
    expect(routeSource).not.toContain('OBF_SALT')
    expect(routeSource).not.toContain("Buffer.from(clientId + OBF_SALT)")
  })

  test('uses the canonical AES-256-GCM credential-encryption module instead', () => {
    expect(routeSource).toContain("import { encryptCredential } from '@/lib/credential-encryption'")
    expect(routeSource).toContain('encryptCredential(clientId)')
    expect(routeSource).toContain('encryptCredential(clientSecret)')
  })

  test('refuses to store a real secret unencrypted if no encryption key is configured, rather than silently falling back to the weak scheme', () => {
    expect(routeSource).toContain('Credential encryption is not configured on this deployment')
  })
})

describe('encryption implementation is consolidated, not triplicated', () => {
  test('backup-v2.ts imports the canonical module instead of carrying its own private AES-256-GCM copy', () => {
    const backupSource = readFileSync(join(ROOT, 'src/lib/backup-v2.ts'), 'utf-8')
    expect(backupSource).toContain("from '@/lib/credential-encryption'")
    expect(backupSource).not.toContain("createCipheriv('aes-256-gcm'")
  })

  test('dr-recovery.ts imports the canonical module instead of carrying its own private AES-256-GCM copy', () => {
    const drSource = readFileSync(join(ROOT, 'src/lib/dr-recovery.ts'), 'utf-8')
    expect(drSource).toContain("from '@/lib/credential-encryption'")
    expect(drSource).not.toContain("createDecipheriv('aes-256-gcm'")
  })
})
