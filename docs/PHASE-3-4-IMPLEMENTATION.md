# Phase 3-4 Implementation

## Phase 3 — Small Business Operations Kit

Implementation: `src/lib/phase3-operations-kit.ts`.

Canonical flow: `intake → observe → map → diagnose → prioritize → design → authorize → implement → measure → learn`.

The implementation records idempotent observations, requires evidence IDs, computes deterministic monthly effort, produces an Operations Plan, and creates a shared Commercial Control Plane workflow. Feasibility scoring is bounded to 0–100 and never fabricates business outcomes.

External provider activation remains blocked until the existing Commercial Control Plane has a valid provider adapter and delegated-authority contract. Phase 3 therefore does not create a second workflow or authority system.

## Phase 4 — Career Command Center

Implementation: `src/lib/phase4-career-command.ts`.

Canonical flow: `profile → discover → organize → prepare → user-approval → submit → track → learn`.

Career application state transitions are monotonic and owner-scoped. A submission approval is a durable, idempotent record in the existing Prisma `Memory` persistence layer. A request for approval is explicitly different from an approval; an application cannot enter `approved` until the owner records approval.

External application submission is intentionally not simulated. The code requires an active, non-expired durable approval and records the commercial event/workflow; an actual external provider adapter remains required before production submission.

Career assistance does not perform automated employment eligibility decisions, candidate ranking, or autonomous hiring recommendations.

## Integrity controls

- No new CRM, billing ledger, event ledger, workflow ledger, evidence ledger, or authority database was introduced.
- Existing Commercial Control Plane identifiers are carried into Phase 3/4 records to prevent domain drift.
- Phase contracts have dedicated regression coverage in `tests/phase3-4-contract.test.ts`.
- Dedicated CI runs the Phase 3/4 contracts against PostgreSQL with frozen Bun dependencies.
- No Vercel deployment or production configuration change is part of this implementation.
