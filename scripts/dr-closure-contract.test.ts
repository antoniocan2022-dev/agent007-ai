import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const restoreSource = readFileSync(join(process.cwd(), 'scripts/dr-restore.ts'), 'utf8')
const backupSource = readFileSync(join(process.cwd(), 'scripts/dr-offsite-backup.ts'), 'utf8')
const workflowSource = readFileSync(join(process.cwd(), '.github/workflows/dr-offsite-backup.yml'), 'utf8')

describe('Disaster Recovery closure contract', () => {
  test('restore requires explicit confirmation and separate targets', () => {
    expect(restoreSource).toContain("confirmation !== 'RESTORE_AGENT007_DR'")
    expect(restoreSource).toContain('productionUrl === recoveryUrl')
    expect(restoreSource).toContain('ph===rh')
  })

  test('restore validates schema fingerprints before writes', () => {
    expect(restoreSource).toContain('schemaFingerprint(sc)')
    expect(restoreSource).toContain('schemaFingerprint(rc)')
    expect(restoreSource).toContain('if(sf!==rf)throw new Error')
  })

  test('restore remains additive and non-destructive', () => {
    expect(restoreSource).toContain('ON CONFLICT DO NOTHING')
    expect(restoreSource).not.toMatch(/\bDELETE FROM\b/i)
    expect(restoreSource).not.toMatch(/\bTRUNCATE\b/i)
  })

  test('backup validates the expected model count and integrity checksum', () => {
    expect(backupSource).toContain('backup.totals.models !== 38')
    expect(backupSource).toContain('backup.integrity?.checksum')
    expect(backupSource).toContain("backupVersion: backup.backupVersion")
  })

  test('offsite upload verifies the object after upload', () => {
    // The workflow uploads and verifies via boto3 (client.put_object / client.head_object),
    // not the AWS CLI's hyphenated `s3api put-object`/`head-object` subcommands -- this
    // assertion was written for an earlier CLI-based version of the workflow and never
    // updated when it was rewritten to use boto3, so it failed on every PR regardless of
    // what that PR actually changed.
    expect(workflowSource).toContain('head_object')
    expect(workflowSource).toContain('put_object')
  })
})
