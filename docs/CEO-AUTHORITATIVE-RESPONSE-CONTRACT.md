# Agent007 CEO — Authoritative Response Contract

This contract defines the trusted structural boundary for user-facing CEO responses.

## Required path

```text
USER REQUEST
      ↓
ONE AUTHORITATIVE CONTRACT
      ↓
ONE CANDIDATE OBJECT
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

`src/lib/ceo-response-contract.ts` creates a frozen `CeoResponseCandidate`. Its SHA-256 hash is the candidate identity. The content and hash are bound together by `assertCeoResponseDecisionEnvelope()`.

## Quality decision

`decideCeoCandidate()` creates a frozen `CeoQualityDecision` containing the candidate id, candidate hash, one quality decision, and the deterministic decision id. A decision cannot reference a different candidate without failing the envelope invariant.

## Finalizer

`src/lib/ceo-response-finalizer.ts` is the only conversational finalization owner. It validates that the supplied content is exactly the candidate content when a decision envelope is supplied, then enforces user-facing safety and produces the final response hash/id.

## Control-plane boundary

`src/lib/ceo-control-plane-summary.ts` defines the typed summary representation allowed to cross into conversational-facing orchestration. Raw telemetry, trace payloads, and execution internals are not part of this summary.

## Persistence lineage

`src/lib/db.ts` adds a single database-client boundary for assistant Message writes. Every assistant create/update records `finalResponseHash` and deterministic `finalizationId` in `AuditLog`, keyed to the persisted Message id. This preserves the existing Message contract while providing independent database lineage evidence.

## Verification requirements

The contract is not considered certified merely because the code exists. Certification requires the Phase 1–8 static audit, authoritative response-contract tests, existing CEO lifecycle regressions, and a successful TypeScript integration check on the exact `main` commit under test.

Production deployment is independent and requires explicit authorization.
