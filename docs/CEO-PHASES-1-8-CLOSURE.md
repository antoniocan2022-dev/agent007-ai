# Agent007 CEO Reliability — Phases 1–8 Closure

This document defines the eight reliability phases implemented by the current hardening pass. The purpose is to make the conversational output path governed, deterministic at its boundaries, and resistant to control-plane contamination.

## Phase 1 — Canonical finalization ownership
`src/lib/ceo-response-finalizer.ts` is the single owner of the final conversational string. `ceo-response-composer.ts` delegates to it instead of maintaining a second sanitizer.

Invariant: no user-facing response is considered final until the canonical finalizer has produced it.

## Phase 2 — Immutable response identity
Every finalized response receives a SHA-256 `finalResponseHash` and deterministic `finalizationId`. The finalization object is frozen, and `assertFinalResponseInvariant()` verifies both content safety and hash integrity.

Invariant: identical final content produces identical response identity; mutated final content fails the hash check.

## Phase 3 — Control-plane containment
Known structured telemetry fragments are removed surgically, while any residual internal artifact token causes fail-closed rejection. Broad catch-all truncation is intentionally avoided so legitimate prose after an artifact is preserved.

Invariant: control-plane identifiers never survive the finalization boundary.

## Phase 4 — Conversational-history hygiene
`ceo-context-composer.ts` now excludes persisted assistant messages that contain internal artifact tokens before those messages are reused as conversational context. User messages remain eligible so the user's current intent is never silently discarded.

Invariant: a previously contaminated assistant turn cannot become fresh prompt context.

## Phase 5 — Provenance attached to quality results
Finalization provenance is part of the canonical `QualityResult` contract. The existing response composer records the exact finalization identity, hash, length, sanitization flag, and rejection flag on the quality object returned through the lifecycle.

Invariant: operational metadata can identify the exact final user-facing string without exposing control-plane payloads in conversation text.

## Phase 6 — One conversational surface
The composer no longer owns independent regex inventories. The finalizer is the single conversational surface sanitizer, while the behavioral policy remains the independent detector/contract authority.

Invariant: sanitization and detection have distinct responsibilities and do not silently drift through duplicate transformation engines.

## Phase 7 — Regression truth-path coverage
`tests/ceo-response-finalizer.test.ts` covers surgical preservation, fail-closed residual-token handling, deterministic identity, contaminated-history isolation, and exact propagation through persistence/SSE/reload-equivalent boundaries.

Invariant: the final string stays byte-for-byte identical at each downstream boundary.

## Phase 8 — Governance and audit closure
`scripts/ceo-phase-1-8-audit.ts` verifies the architecture is present and that the previous duplicate composer sanitizer has not returned. This document is the human-readable contract for the eight phases.

Invariant: future changes must extend the canonical boundary instead of adding another output sanitizer or another conversational artifact path.

## Deployment rule
This change is intentionally GitHub-only. Production deployment remains a separate, explicit authorization event and must not be inferred from a green test or from the existence of a `main` commit.
