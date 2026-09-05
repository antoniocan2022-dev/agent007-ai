# Agent007 CEO — Authoritative Response Contract

This contract defines the trusted structural boundary for user-facing CEO responses.

## Required path

```text
USER REQUEST
      ↓
ONE AUTHORITATIVE CONTRACT
      ↓
ONE IMMUTABLE CANDIDATE OBJECT
      ↓
ONE IMMUTABLE QUALITY DECISION
      ↓
ONE FINALIZER
      ↓
ONE IMMUTABLE FINAL RESPONSE
      ↓
 ┌──────────────┬──────────────┬──────────────┐
 ↓              ↓              ↓
SSE          DATABASE         RELOAD
 ↓              ↓              ↓
 └──────────────┴──────────────┘
                 ↓
            SAME CONTENT
```

## Candidate

`src/lib/ceo-response-contract.ts` creates one frozen `CeoResponseCandidate`. Its SHA-256 hash is its identity. The content and hash are bound together by `assertCeoResponseDecisionEnvelope()`.

## Quality decision

`decideCeoCandidate()` creates one frozen `CeoQualityDecision` containing the candidate id, candidate hash, one quality decision, and deterministic decision id. A decision cannot reference a different candidate without failing the envelope invariant.

## Control-plane boundary

`src/lib/ceo-control-plane-summary.ts` defines the bounded typed `CeoControlPlaneSummary`. It is embedded in the authoritative response-decision envelope so evidence state, quality state, execution completion, verification and degraded state cross the boundary as typed fields rather than raw telemetry strings.

## Candidate preparation and finalizer

`prepareCeoCandidateContent()` performs deterministic control-plane artifact cleanup before the authoritative candidate is created. Once the envelope exists, `src/lib/ceo-response-finalizer.ts` is validation-only: it verifies candidate identity and user-facing safety and does not mutate the accepted candidate.

## Persistence lineage

`src/lib/ceo-response-persistence.ts` is the transactional persistence boundary. It requires finalization provenance, verifies the response SHA-256 hash, deterministic finalization id, and content length, then atomically persists the assistant `Message` and an `AuditLog` lineage record keyed to the persisted Message id. `finalResponseHash`, `finalizationId`, candidate identity and quality-decision identity are independently queryable from the database without changing the existing Message contract.

## Response propagation

The CEO API sends the canonical lifecycle `response.content` through SSE and the same finalized content through the transactional persistence adapter. Operational synthesis uses the same adapter for its assistant-message update. No post-quality user-facing prefix or alternate sanitizer is permitted to mutate the accepted candidate.

## Conversation-plane hygiene

Persisted assistant rows containing internal artifact tokens are filtered by the shared `safeConversationRows()` boundary before context composition, conversation-state derivation, continuity intelligence, world-model extraction, quality evaluation, degraded recovery, and lifecycle execution.

## Certification requirements

Certification requires the authoritative Phase 1–8 architecture audit, authoritative response-contract tests, CEO lifecycle regression corpus, and TypeScript integration graph to pass on the same exact `main` commit. Green CI is evidence for that commit only; it does not imply production deployment.

Production deployment is a separate explicit authorization event.
