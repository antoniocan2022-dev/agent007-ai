# Agent007 Backup V2 — Disaster Recovery

## Purpose

Backup V2 is the authoritative application-state recovery format for Agent007. It is separate from source control and from the older `/api/backup` and `/api/system/vid-backup` exports.

## Coverage

The exporter covers the 38 Prisma models currently defined in `prisma/schema.prisma`. Each model includes a record count and normalized row data. The export also records:

- Backup format version
- Generation timestamp
- Git commit and branch
- Vercel environment
- Database schema fingerprint
- Model and record totals
- SHA-256 integrity checksum
- Secret-field handling policy

## Security

The Backup V2 route is intentionally protected by the normal application authentication middleware. It must not be added to the public middleware whitelist.

Sensitive fields are never emitted as plaintext. When `BACKUP_ENCRYPTION_KEY` is configured, sensitive values are encrypted using AES-256-GCM and stored in the recovery envelope. Without that key, secret fields are omitted by design.

Configure the same strong `BACKUP_ENCRYPTION_KEY` in Vercel Production and any recovery environment that must decrypt credential fields. Never commit the key to GitHub and never place it in the JSON backup itself.

## Restore policy

Restore is additive and non-destructive:

1. `inspect` validates format, model coverage, and checksum.
2. `restore` defaults to dry-run.
3. A real restore must explicitly set `dryRun: false`.
4. Records are inserted by primary key with `ON CONFLICT DO NOTHING`.
5. The restore operation never deletes production data.

For a true disaster recovery event, restore into a fresh database first, validate application health, then perform controlled cutover. Do not use the additive restore endpoint as a production reset mechanism.

## Endpoints

- `GET /api/system/backup-v2?format=json`
- `GET /api/system/backup-v2?format=gzip`
- `POST /api/system/backup-v2` with `{ "mode": "inspect", "backup": ... }`
- `POST /api/system/backup-v2` with `{ "mode": "restore", "backup": ..., "dryRun": true }`

## Baseline

The August 8, 2026 production baseline is Git commit `d24f4061a1bb30b68196c638f14ff35d32a33c8f` before Backup V2. The Backup V2 implementation is developed on branch `backup-v2-disaster-recovery` and must pass Vercel preview validation before merging to `main`.
