# Agent007 AI — 77-Hour Deep Coherence Audit

**Audit window:** 2026-08-09 16:25 UTC → 2026-08-12 21:25 UTC
**Scope:** repository evolution, upgrade/fix churn, runtime contracts, documentation truth, duplicate-file risk, missing-file risk, CI coverage, provider/model/performance/outcome intelligence, revenue/DR/hosting hardening.

## Executive conclusion

The repository is not showing one single catastrophic regression. The dominant problem is **integration drift caused by very high change velocity**: several independently correct fixes were landing in rapid succession across governance, providers, model selection, performance intelligence, outcome intelligence, revenue, DR, hosting portability, and CI. The resulting risk is that a local fix can be correct while another layer still carries an older contract.

The most important observed patterns were:

1. **Documentation drift** — README contained historical hard-coded inventory counts even though the runtime had moved substantially beyond them.
2. **Audit/report duplication by history** — multiple root-level audit reports remain useful as historical evidence, but they can be mistaken for current architecture truth.
3. **Contract fragmentation** — the new Outcome Intelligence module initially existed with tests and CI coverage, but the governed provider runtime had no explicit bridge for verified outcome evidence.
4. **Rapid corrective churn** — the last 77 hours contain many fix-after-feature and fix-after-audit commits. This is evidence of a process problem, not simply individual coding mistakes.
5. **CI coverage was strong but asymmetric** — deep integrity and intelligence tests existed, while repository-level coherence rules were not yet a dedicated merge gate.
6. **The system was increasingly using multiple sources of truth** — source registries, runtime descriptors, historical audit documents and README inventory statements could disagree without one canonical documentation contract.

## What was fixed

### 1. Canonical documentation truth
`README.md` no longer publishes hard-coded tool, sub-agent or Prisma-model counts. It now describes the architecture and explicitly identifies source registries, Prisma schema and CI audits as the sources of truth.

### 2. Repository coherence gate
Added `scripts/repository-coherence-audit.ts` with checks for:

- required architecture files;
- case-insensitive duplicate paths;
- exact duplicate production source files;
- stale hard-coded README counts;
- historical Vercel hostname leakage into application source;
- Outcome/Performance Intelligence separation;
- provider runtime performance evidence recording;
- required CI merge-gate coverage.

### 3. CI integration
`autonomy-ci.yml` now executes both the deep integrity audit and repository coherence audit on main and development/feature/fix/integration merge gates.

### 4. Runtime Outcome Intelligence integration
`provider-runtime-v2.ts` now accepts **optional verified outcome evidence**. This is deliberately opt-in: a successful HTTP response does not automatically become a successful business outcome. When the verifier/mission layer supplies evidence, the selected provider/model/task observation is recorded in Outcome Intelligence.

### 5. Regression test
Added an integration test proving that verified outcome evidence supplied through the governed runtime becomes Outcome Intelligence evidence, while the transport-only path remains separate.

### 6. Audit commands
Added:

```bash
bun run audit:deep
bun run audit:coherence
```

## Root-cause model

The recurring failures are best understood as a **change-velocity / integration-surface problem**:

```text
Feature request
    ↓
new implementation
    ↓
local test passes
    ↓
second layer upgraded
    ↓
old contract remains elsewhere
    ↓
repair commit
    ↓
new CI guard
    ↓
another adjacent contract exposed
```

This cycle is normal during aggressive system evolution, but it becomes dangerous when every new capability creates its own source of truth.

The solution is therefore not simply “test more.” The solution is to make **integration contracts executable and centralized**.

## Preventive rules for future upgrades

### Rule A — One canonical source of truth
Do not encode architecture counts or capability inventories in README, prompts, dashboards or audit prose unless they are generated from a registry.

### Rule B — Every new intelligence layer needs four artifacts
A new intelligence subsystem is not complete until it has:

1. implementation;
2. unit/contract tests;
3. runtime integration seam;
4. CI merge-gate coverage.

### Rule C — Separate transport evidence from business evidence
HTTP success, provider availability and latency are **performance evidence**. They are not business outcomes. Verified outcomes must enter through an explicit verifier/mission boundary.

### Rule D — Feature + integration + regression in one change set
When a new feature is added, its first commit sequence should include its integration seam and regression test rather than postponing integration until a later audit.

### Rule E — Historical audits are evidence, not truth
Old audit reports must remain immutable evidence. Current truth must come from source, registries, CI and the latest audit run.

### Rule F — Fix the class of bug, not only the instance
If an audit finds a stale count, add a rule preventing stale counts. If it finds a duplicate artifact, add a duplicate-artifact detector. If it finds provider drift, centralize the policy and test the policy.

### Rule G — Never change dependencies during an unrelated hardening change
Dependency manifests are high-blast-radius files. They require an explicit dependency-change scope and lockfile verification. Audit tooling should not alter dependency versions.

## Remaining classification

The historical root-level `AUDIT-*.md` files are **not treated as duplicate source files**. They are historical audit evidence from different windows. Removing them would destroy forensic context. Their risk is documentation ambiguity, which is now addressed by the canonical README language and this current audit report.

## Final standard

Agent007 should now treat repository coherence as a first-class reliability dimension alongside:

- runtime correctness;
- security;
- revenue integrity;
- disaster recovery;
- provider governance;
- model intelligence;
- outcome verification;
- autonomy.

The objective is to make future upgrades **boringly integratable**: one contract, one source of truth, one integration seam, one regression test, one CI gate.
