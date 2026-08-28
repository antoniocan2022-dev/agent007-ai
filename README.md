# Agent007 AI

> Autonomous AI organization with governed providers, model intelligence, outcome intelligence, self-repair, revenue controls, disaster recovery, and evidence-based autonomy.

[![Deploy on Vercel](https://img.shields.io/badge/Deploy%20on-Vercel-black.svg)](https://vercel.com/new)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black.svg)](https://nextjs.org)
[![TypeScript-strict](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://www.typescriptlang.org)

## Release marker

Production release authorized on **2026-08-24** from GitHub `main`. This marker is documentation-only and does not change runtime behavior.

**Release execution marker:** 2026-08-24T20:58-04:00

**Current production trigger:** [AUTHORIZED_PRODUCTION_RELEASE]

**Current production fix trigger:** [AUTHORIZED_PRODUCTION_FIX_RELEASE]

**Final production release authorization:** [AUTHORIZED_PRODUCTION_RELEASE]

**CEO responsiveness release authorization:** [AUTHORIZED_PRODUCTION_RELEASE] — bounded direct CEO lane for ordinary conversations; deep, mission, attachment and context-dependent requests retain the full cognitive lifecycle.

**Authorized production release — 2026-08-27:** [AUTHORIZED_PRODUCTION_RELEASE] — deploy current GitHub `main` through the governed production watchdog after green CI validation.

**CEO reasoning reliability release — 2026-08-27:** [AUTHORIZED_PRODUCTION_RELEASE] — self-assessment requests preserve the canonical reasoning task type, use resilient provider failover, recover truthful internal evidence in degraded mode, and keep explicit operational intent ahead of adaptive mission classification.

**Authorized existing-production promotion — 2026-08-28:** [AUTHORIZED_EXISTING_PRODUCTION_PROMOTION] — promote existing repaired Vercel deployment `dpl_F9SzTZ6Si6LnajzE2GWFsckAxfHX` for source SHA `894ad178299d30c891bd33f74c14bc3722e6eff9`; verify legacy deployment `dpl_6gpKhJ8up8Yhg6ujWHCGV4TgHJ1U` loses production aliases and traffic.

**Corrected existing-production promotion authorization — 2026-08-28:** [AUTHORIZED_EXISTING_PRODUCTION_PROMOTION] [PROMOTE_EXISTING_DEPLOYMENT:dpl_F9SzTZ6Si6LnajzE2GWFsckAxfHX] [PROMOTE_EXISTING_SOURCE_SHA:894ad178299d30c891bd33f74c14bc3722e6eff9] [PREVIOUS_PRODUCTION_DEPLOYMENT:dpl_6gpKhJ8up8Yhg6ujWHCGV4TgHJ1U] — rerun the corrected, idempotent promotion/alias/traffic watchdog without rebuilding the repaired deployment.

**Final alias-registry reconciliation authorization — 2026-08-28:** [AUTHORIZED_EXISTING_PRODUCTION_PROMOTION] [PROMOTE_EXISTING_DEPLOYMENT:dpl_F9SzTZ6Si6LnajzE2GWFsckAxfHX] [PROMOTE_EXISTING_SOURCE_SHA:894ad178299d30c891bd33f74c14bc3722e6eff9] [PREVIOUS_PRODUCTION_DEPLOYMENT:dpl_6gpKhJ8up8Yhg6ujWHCGV4TgHJ1U] — use the authoritative Vercel alias registry to remove stale legacy alias records, reassign production aliases to the repaired deployment, and prove zero old-deployment traffic.

**Final alias-registry reconciliation authorization — corrected — 2026-08-28:** [AUTHORIZED_EXISTING_PRODUCTION_PROMOTION] [PROMOTE_EXISTING_DEPLOYMENT:dpl_F9SzTZ6Si6LnajzE2GWFsckAxfHX] [PROMOTE_EXISTING_SOURCE_SHA:894ad178299d30c891bd33f74c14bc3722e6eff9] [PREVIOUS_PRODUCTION_DEPLOYMENT:dpl_6gpKhJ8up8Yhg6ujWHCGV4TgHJ1U] — rerun alias assignment using Vercel's documented assignment semantics and verify registry ownership and zero legacy traffic without an explicit alias-delete loop.

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
Autonomy
```
