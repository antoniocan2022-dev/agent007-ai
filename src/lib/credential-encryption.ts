/**
 * Canonical AES-256-GCM credential encryption, used everywhere a real secret (not a hash, not a
 * public identifier) needs to be stored at rest and later recovered for real use. Extracted from
 * backup-v2.ts's private encryptSecret/decryptSecret (which encrypted arbitrary JSON values for the
 * backup/restore flow) so a second, weaker "obfuscation" scheme -- base64 plus a hardcoded public
 * salt string, as /api/paypal-accounts/route.ts used -- never gets invented again for a live-storage
 * path. Base64-with-a-public-salt is not encryption: anyone with read access to the stored value can
 * trivially reverse it, salt included, since the salt is public source code, not a secret.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

function resolveKey(raw: string): Buffer {
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex')
  return createHash('sha256').update(raw, 'utf8').digest()
}

export function getCredentialEncryptionKey(): Buffer | null {
  const raw = (process.env.CREDENTIAL_ENCRYPTION_KEY ?? process.env.BACKUP_ENCRYPTION_KEY)?.trim()
  if (!raw) return null
  return resolveKey(raw)
}

/** Encrypts an arbitrary JSON-serializable value. Envelope: base64url(iv).base64url(tag).base64url(ciphertext). */
export function encryptSecretValue(value: unknown): string {
  const key = getCredentialEncryptionKey()
  if (!key) throw new Error('CREDENTIAL_ENCRYPTION_KEY (or BACKUP_ENCRYPTION_KEY) is required to encrypt secret fields')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8')
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv, tag, ciphertext].map((b) => b.toString('base64url')).join('.')
}

export function decryptSecretValue(payload: string): unknown {
  const key = getCredentialEncryptionKey()
  if (!key) throw new Error('CREDENTIAL_ENCRYPTION_KEY (or BACKUP_ENCRYPTION_KEY) is required to decrypt secret fields')
  const [ivB64, tagB64, dataB64] = payload.split('.')
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('Invalid encrypted secret envelope')
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'))
  const plaintext = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64url')), decipher.final()])
  return JSON.parse(plaintext.toString('utf8'))
}

/** String-specific convenience wrappers for the common case (a single credential field). */
export function encryptCredential(value: string): string { return encryptSecretValue(value) }
export function decryptCredential(payload: string): string { return decryptSecretValue(payload) as string }
