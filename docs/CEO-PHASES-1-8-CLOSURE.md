# Agent007 CEO Reliability — Phases 1–8 Closure

This document defines the reliability boundary for governed conversational output. The target architecture is not another sanitizer; it is a single contract chain with immutable identity and separated control/conversation planes.

## Phase 1 — Canonical finalization ownership
`src/lib/ceo-response-finalizer.ts` is the single owner of the final conversational string. `ceo-response-composer.ts` is an orchestration/compatibility layer and delegates finalization to the canonical finalizer.

Invariant: no user-facing response is considered final until the canonical finalizer has produced it.

## Phase 2 — Immutable response identity
Every finalized response receives a SHA-256 `finalResponseHash` and deterministic `finalizationId`. The finalization object is frozen, and `assertFinalResponseInvariant()` verifies content safety and hash integrity.

Invariant: identical final content produces identical response identity; mutated final content fails the identity check.

## Phase 2A — One candidate / one quality decision
`src/lib/ceo-response-contract.ts` constructs one frozen `CeoResponseCandidate` and one frozen `CeoQualityDecision` bound by candidate id and SHA-256 hash. The finalizer verifies the envelope before finalization.

Invariant: a quality decision cannot be attached to a different candidate without an explicit contract failure.

## Phase 3 — Control-plane containment
Known structured telemetry fragments are removed surgically, while residual internal artifact tokens cause fail-closed rejection. Broad catch-all truncation is intentionally avoided so legitimate prose after an artifact is preserved.

Invariant: control-plane identifiers never survive the finalization boundary.

## Phase 4 — Conversational-history hygiene
`ceo-context-composer.ts`, conversation state, context intelligence, world model, quality evaluation, and degraded recovery use the shared artifact-aware conversation boundary. Persisted assistant messages containing control-plane artifacts cannot become fresh conversational context.

Invariant: contaminated assistant history is quarantined consistently across all context consumers.

## Phase 5 — Provenance attached to quality results
Finalization provenance is part of `QualityResult` and records finalization identity, hash, length, sanitization, and rejection status. Candidate and quality-decision identity are also carried by finalized-response provenance.

Invariant: operational metadata can identify the exact final user-facing string without exposing control-plane payloads in conversation text.

## Phase 6 — One conversational surface
The composer no longer owns an independent artifact-token inventory. The behavioral policy owns artifact detection, the response contract owns candidate/decision identity, and the finalizer owns final conversational validation/output.

Invariant: each responsibility has one canonical authority; no duplicate transformation engine is allowed.

## Phase 7 — Regression truth-path
`tests/ceo-response-finalizer.test.ts` and `tests/ceo-response-contract.test.ts` cover surgical preservation, fail-closed residual handling, deterministic response identity, candidate tamper detection, contaminated-history isolation, and exact propagation across persistence/SSE/reload-equivalent boundaries.

Invariant: the final string and its identity remain consistent at downstream boundaries.

## Phase 8 — Governance and audit closure
`scripts/ceo-phase-1-8-audit.ts` verifies the canonical response contract, typed control-plane boundary, contamination quarantine across context/state/intelligence/world-model/quality/degraded paths, database response-lineage enforcement, route transport/persistence wiring, and the absence of the legacy duplicate sanitizer.

## Database lineage
The canonical Prisma client in `src/lib/db.ts` enforces assistant-message response lineage at the persistence boundary. Every assistant message create/update records the SHA-256 response hash and deterministic finalization id in `AuditLog`, keyed by the persisted Message id. This avoids changing the existing Message schema/attachment contract while providing independent persistence evidence.

## Control-plane typed summary
`src/lib/ceo-control-plane-summary.ts` defines the bounded, typed summary representation intended for any control-plane information that must cross into conversational-facing orchestration. Raw telemetry and trace payloads are not part of this contract.

## Certification rule
The architecture is considered certified only when the authoritative Phase 1–8 audit, authoritative response-contract tests, existing CEO lifecycle regression corpus, and TypeScript integration graph all pass on the same `main` commit. Green CI is evidence for that commit only; it does not imply production deployment.

## Deployment rule
These changes are intentionally GitHub-only. Production deployment remains a separate, explicit authorization event and must not be inferred from a green test or from the existence of a `main` commit.
