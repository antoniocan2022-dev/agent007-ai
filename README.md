# Agent007 AI

> Autonomous AI organization with governed providers, model intelligence, outcome intelligence, self-repair, revenue controls, disaster recovery, and evidence-based autonomy.

[![Deploy on Vercel](https://img.shields.io/badge/Deploy%20on-Vercel-black.svg)](https://vercel.com/new)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black.svg)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://www.typescriptlang.org)

## Architecture truth

Agent007's runtime inventory is intentionally **not represented by hard-coded counts in this README**. The repository registries, Prisma schema, governance contracts, and CI audits are the sources of truth. This prevents documentation from becoming stale after rapid upgrades.

The current architecture separates:

- **Provider Governance** — deterministic provider priority, verification policy, health and circuit breaking.
- **Model Intelligence** — governed task/model fit, quality, speed, cost and capability priors.
- **Performance Intelligence** — observed transport success and latency.
- **Outcome Intelligence** — verified task outcomes, quality, business value and confidence.
- **Autonomy Runtime** — governed scheduling, tool execution and evidence-based autonomy scoring.
- **Revenue Integrity** — transaction truth, idempotency, fulfillment security and reconciliation.
- **Disaster Recovery** — schema-aware backup/restore and provider-neutral offsite storage.
- **Hosting Independence** — provider-neutral public URL, background task, storage, checkout and download boundaries.

### Intelligence hierarchy

```text
Governance
    ↓
Provider Intelligence
    ↓
Model Intelligence
    ↓
Performance Intelligence
    ↓
Outcome Intelligence
    ↓
Verified decision evidence
```

Outcome Intelligence deliberately does **not** treat an HTTP-successful model call as a successful business outcome. Runtime evidence must be verified before it can influence future recommendations.

## Quick Deploy

```bash
unzip agent007-ai.zip -d agent007-ai
cd agent007-ai
bun install
cp .env.example .env  # edit with your secrets
bunx prisma generate && bunx prisma db push
bash scripts/deploy-vercel.sh
```

## Database Setup

Agent007 uses Postgres via Prisma. On Vercel serverless, use a connection pooler to reduce cold-start latency and connection exhaustion risk.

### Provider-specific setup

**Neon** (recommended, free tier):
1. Create a project at https://neon.tech
2. Copy the pooled connection string.
3. Set `DATABASE_URL` to the pooled URL with SSL enabled.

**Supabase** (free tier):
1. Create a project at https://supabase.com
2. Use the transaction-mode pooled connection string.
3. Configure `DATABASE_URL` according to Supabase's current pooling guidance.

**Vercel Postgres:**
1. Create/connect the database from the Vercel project.
2. Verify that the resulting `DATABASE_URL` is appropriate for the deployment runtime.

## Verification and CI

Before changes are considered complete, Agent007's CI gates include:

- deep integrated repository integrity audit;
- subagent and provider governance validation;
- provider/model/performance/outcome intelligence tests;
- Prisma-backed autonomy tests;
- TypeScript correctness;
- linting;
- revenue integrity and fulfillment security checks;
- disaster-recovery and hosting-independence checks where applicable.

Run the primary repository audit locally with:

```bash
bun scripts/deep-integrity-audit.ts
```

The audit is designed to detect registry drift, tracked runtime artifacts, machine-specific paths, insecure fulfillment assumptions, missing canonical URL resolution, missing CI merge gates, and other integration regressions.

## Tools and capabilities

Agent007 has a large and evolving tool inventory. **Do not rely on a historical tool count.** The registry and capability architecture are authoritative.

The intended hierarchy is:

```text
Enterprise capability
    ↓
Capability domain
    ↓
Capability
    ↓
Service
    ↓
Tool
    ↓
Function
```

This keeps executive reasoning above the implementation-level tool registry and reduces registry drift as the system grows.

## Sub-agents

Agent007 uses governed specialist roles. The authoritative registry and governance contracts define the active roster; documentation should not duplicate or hard-code a historical count.

## Security

- NextAuth authentication
- 2FA support
- bcrypt password hashing
- rate limiting on authentication endpoints
- CSRF protection
- audit logging
- ownership-bound fulfillment and download controls
- provider/task governance
- fail-closed behavior for protected revenue operations
- disaster-recovery integrity checks

## Prisma

`prisma/schema.prisma` is the source of truth for database models. Backup registries are checked by CI against the Prisma schema so schema/backup drift cannot silently accumulate.

## Audit documentation

Historical audit reports are retained as evidence of prior findings and remediation. They are **not** current architecture truth. Current repository state is established by source code, registries, CI, and the latest audit run.

## License

Private — All rights reserved.
