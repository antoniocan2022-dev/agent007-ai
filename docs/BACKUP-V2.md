# Agent007 Backup V2.1 — Disaster Recovery

## Purpose

Backup V2.1 is the authoritative application-state recovery format for Agent007. It is separate from source control and from the older `/api/backup` and `/api/system/vid-backup` exports.

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
- Historical credential-redaction count

## Security

The Backup V2.1 route is intentionally protected by the normal application authentication middleware. It must not be added to the public middleware whitelist.

Sensitive database fields are never emitted as plaintext. When `BACKUP_ENCRYPTION_KEY` is configured, sensitive database values are encrypted using AES-256-GCM and stored in the recovery envelope. Without that key, secret fields are omitted by design.

Historical conversation, message, audit, and tool-argument data can contain credentials even when those values are not schema-level secret columns. V2.1 therefore redacts common credential-bearing query parameters, bearer tokens, and sensitive JSON/object keys from public backup rows. The backup records how many such redactions occurred.

Configure the same strong `BACKUP_ENCRYPTION_KEY` in Vercel Production and any recovery environment that must decrypt credential fields. Never commit the key to GitHub and never place it in the JSON backup itself.

Treat every pre-V2.1 backup as potentially sensitive. If an older backup contains live credentials in historical records, rotate those credentials and do not redistribute the old backup.

## Restore policy

Restore is additive and non-destructive:

1. `inspect` validates format, model coverage, and checksum.
2. Restore defaults to dry-run.
3. A real restore must explicitly set `dryRun: false`.
4. Records are inserted by primary key with `ON CONFLICT DO NOTHING`.
5. The restore operation never deletes production data.
6. A real disaster-recovery exercise should use a fresh recovery database first.

For a true disaster recovery event, restore into a fresh database first, validate application health, then perform controlled cutover. Do not use the additive restore endpoint as a production reset mechanism.

## Endpoints

- `GET /api/system/backup-v2?format=json`
- `GET /api/system/backup-v2?format=gzip`
- `POST /api/system/backup-v2` with `{ "mode": "inspect", "backup": ... }`
- `POST /api/system/backup-v2` with `{ "mode": "restore", "backup": ..., "dryRun": true }`

## Recovery package

Store each approved recovery point outside the source repository, for example:

```text
Agent007/
└── Disaster-Recovery/
    └── YYYY-MM-DD/
        ├── agent007-backup-v2-YYYY-MM-DDTHH-mm-ss.json.gz
        ├── manifest.json
        ├── checksum.txt
        └── README-RECOVERY.md
```

Keep at least two secure copies. Do not publish backup files or commit them to GitHub.

## Current baseline

Backup V2.1 was implemented on `main` after the original Backup V2 deployment. The latest Backup V2.1 source commit is tracked by GitHub and deployed through the connected Vercel Production project. Always record the exact Git commit and backup checksum alongside each recovery package.
