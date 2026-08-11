# Disaster Recovery Closure Contract

## Scope

This workstream closes the repository-side Disaster Recovery architecture and verification contracts without depending on the active production host.

## Backup invariants

1. Backup generation requires the production database URL and encryption key.
2. Backup V2 must pass structural inspection before an artifact is emitted.
3. The expected schema contains 38 models; model and record totals are reported.
4. Backup integrity includes a SHA-256 checksum.
5. Sensitive fields are encrypted or redacted according to the backup security policy.
6. The compressed artifact receives an independent SHA-256 checksum before offsite upload.

## Restore invariants

1. Restore requires the explicit `RESTORE_AGENT007_DR` confirmation token.
2. Production and recovery database URLs are required and must not be equal.
3. Production and recovery hosts must be positively distinguishable; otherwise restore is refused.
4. Recovery schema fingerprint must match the production schema fingerprint before restore.
5. Restore uses the explicit dependency-safe table order.
6. Restore is additive and uses `ON CONFLICT DO NOTHING`; it does not delete or overwrite existing recovery data.
7. Secret fields are encrypted in the backup and decrypted only during restore.
8. Dry-run mode performs all safety/schema checks without writing restore data.
9. Restore verification reports recovered model and record counts.

## Offsite-storage invariants

1. Offsite storage is an infrastructure adapter, not part of Agent007 business logic.
2. The workflow must consume storage endpoint, region, namespace and bucket configuration from deployment configuration/secrets.
3. The backup workflow must verify bucket access before generating or uploading a backup.
4. The uploaded object must be verified with a metadata/head-object check after upload.
5. A missing/inaccessible bucket is a hard failure; the workflow must never report an offsite backup as successful.

## Hosting independence

The application, backup generation, backup inspection, restore logic, schema fingerprinting and recovery safety rules do not depend on Vercel or any specific compute host. Object storage is treated as a replaceable infrastructure adapter.

## Closure boundary

Repository-side DR architecture is complete when backup generation, integrity validation, restore safety, schema matching and dry-run contracts are green in GitHub CI.

External offsite-storage connectivity remains an infrastructure verification gate. The current OCI bucket must be corrected/verified separately before claiming that an actual offsite backup has been successfully delivered to production storage.
