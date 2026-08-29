# CEO P0–P2 Architectural Invariants

This document is the canonical design contract for the CEO conversation/evidence architecture and the production release control plane.

## 1. Conversation continuity

The server is the authority for conversation history. `conversationId` is resolved to an authenticated owner and persisted user/assistant turns are composed before CEO classification and reasoning.

## 2. Context ownership

`src/lib/ceo-context-composer.ts` is the single context-composition boundary. Route handlers provide structured inputs; they must not hand-assemble organization, evidence, mission, memory, execution, or conversation prompt blocks.

## 3. Context is not evidence

Conversation history and persistent memory are context only. Previous assistant statements never become verified factual evidence without an explicit evidence source and provenance mapping.

## 4. Adaptive governance

Conversational requests receive conversational quality validation. External evidence verification and critical execution verification apply only when the existing classified request requires them. No new parallel intent taxonomy may be introduced to bypass this rule.

## 5. Public-equity safety

Short requests such as `Buy GEOS` must remain governed when they imply financial action or external evidence. `executionClass=fast` alone is never a governance bypass condition.

## 6. Evidence integrity

External evidence is represented as a typed bundle with source identity, source tier, retrieval/publication timestamps, freshness, claim candidates, and provenance. Search discovery is not automatically authoritative financial evidence.

## 7. Failure integrity

CEO runtime, evidence recovery, degraded responses, and production diagnostics use the same canonical `CeoFailureReason` vocabulary.

## 8. Release integrity

A production deployment is valid only when the authorized release SHA, certified SHA, current `main` SHA, and deployed SHA are the same exact 40-hex commit. Authorization is production-target-bound, explicit, and time-bounded.

## 9. Repository integrity

Critical architecture files and workflows must remain single-source. New duplicate implementations or route-level prompt composition outside the canonical composer are CI failures. Critical files are represented in the unified release integrity manifest by Git blob SHA, SHA-256 byte digest, and byte length.

## 10. Verification priority

The authoritative order is:

`GitHub main ref → exact commit tree → certification → explicit authorization → Vercel deployment → live runtime proof`

No intermediate tool rendering is authoritative over the actual GitHub commit/tree.

## 11. Reference-resolution invariant

Any release reference supplied to production must resolve to the current `refs/heads/main` commit before mutation. A stale, syntactically invalid, detached, or ambiguous release reference is rejected. The production workflow checks both the immutable commit object and the live `main` ref before deployment.

## 12. Unified release integrity manifest

The canonical manifest generator is `scripts/build-release-integrity-manifest.ts`. It records the release identity chain plus critical-file Git blob and byte hashes. CI generates the manifest as an artifact without committing generated release state back to `main`; the production release workflow may attach deployment identity after the target deployment is proven.

## 13. Regression corpus

`tests/ceo-context-boundary-integrity.test.ts`, `tests/release-integrity-contract.test.ts`, `tests/release-integrity-manifest.test.ts`, `tests/critical-file-integrity.test.ts`, and `tests/governance-release-regression.test.ts` form the P0–P2 governance regression corpus. The autonomy CI gate executes this corpus before certification.
