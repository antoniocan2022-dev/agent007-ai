import { describe, expect, test, afterEach } from 'bun:test'
import { encryptCredential, decryptCredential, encryptSecretValue, decryptSecretValue, getCredentialEncryptionKey } from '@/lib/credential-encryption'

const originalCredKey = process.env.CREDENTIAL_ENCRYPTION_KEY
const originalBackupKey = process.env.BACKUP_ENCRYPTION_KEY

afterEach(() => {
  if (originalCredKey === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY; else process.env.CREDENTIAL_ENCRYPTION_KEY = originalCredKey
  if (originalBackupKey === undefined) delete process.env.BACKUP_ENCRYPTION_KEY; else process.env.BACKUP_ENCRYPTION_KEY = originalBackupKey
})

// Live-audit finding: /api/paypal-accounts/route.ts previously "protected" real PayPal client
// credentials with Buffer.from(value + hardcodedPublicSalt).toString('base64') -- base64 with a salt
// that's public source code is not encryption, it's a one-line-reversible encoding. This module is the
// canonical AES-256-GCM replacement, now shared by that route and by backup-v2.ts/dr-recovery.ts (which
// each used to carry their own private, independently-duplicated copy of the same scheme).
describe('credential-encryption', () => {
  test('encrypt/decrypt round-trips a credential string exactly', () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = 'test-key-material-not-real'
    const secret = 'sk_live_totally_a_real_paypal_client_secret'
    const encrypted = encryptCredential(secret)
    expect(encrypted).not.toContain(secret)
    expect(encrypted.split('.').length).toBe(3)
    expect(decryptCredential(encrypted)).toBe(secret)
  })

  test('the encrypted envelope is not reversible by base64-decoding alone -- proving it is real encryption, not encoding', () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = 'test-key-material-not-real'
    const secret = 'another-real-looking-secret-value'
    const encrypted = encryptCredential(secret)
    const [, , ciphertextB64] = encrypted.split('.')
    const rawDecoded = Buffer.from(ciphertextB64!, 'base64url').toString('utf8')
    expect(rawDecoded).not.toContain(secret)
  })

  test('round-trips arbitrary JSON-serializable values, not just strings', () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = 'test-key-material-not-real'
    const value = { clientId: 'abc', scopes: ['payouts', 'orders'], verified: true }
    const encrypted = encryptSecretValue(value)
    expect(decryptSecretValue(encrypted)).toEqual(value)
  })

  test('refuses to encrypt or decrypt when no key is configured, rather than silently falling back to a weak scheme', () => {
    delete process.env.CREDENTIAL_ENCRYPTION_KEY
    delete process.env.BACKUP_ENCRYPTION_KEY
    expect(getCredentialEncryptionKey()).toBeNull()
    expect(() => encryptCredential('x')).toThrow(/CREDENTIAL_ENCRYPTION_KEY/)
    expect(() => decryptCredential('a.b.c')).toThrow(/CREDENTIAL_ENCRYPTION_KEY/)
  })

  test('BACKUP_ENCRYPTION_KEY alone still works -- the widening to also accept CREDENTIAL_ENCRYPTION_KEY is additive, not a breaking change for backup-v2.ts/dr-recovery.ts', () => {
    delete process.env.CREDENTIAL_ENCRYPTION_KEY
    process.env.BACKUP_ENCRYPTION_KEY = 'legacy-backup-key-material'
    const secret = 'legacy-path-secret'
    const encrypted = encryptCredential(secret)
    expect(decryptCredential(encrypted)).toBe(secret)
  })

  test('a 64-char hex string is used as a raw key rather than being hashed again', () => {
    const hexKey = 'a'.repeat(64)
    process.env.CREDENTIAL_ENCRYPTION_KEY = hexKey
    const key = getCredentialEncryptionKey()
    expect(key?.toString('hex')).toBe(hexKey)
  })
})
