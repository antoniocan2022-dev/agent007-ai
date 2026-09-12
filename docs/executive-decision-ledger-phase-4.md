# Executive Decision Ledger — Phase 4 design (governed autonomy)

Status: **design only**. Nothing in this document is wired. No code in this repository grants
the CEO any new autonomous authority over money, people, or execution as a result of this file.
It exists so that, once the ledger has accumulated real evidence (see "Why this is deferred"
below), the next increment of autonomy has a concrete, reviewed shape to build against instead of
being designed from scratch under time pressure.

Phases 1-3 (shipped in this same body of work) gave the CEO a durable, queryable record of what it
decided, why, for which venture/strategy/leader, and whether the decision's business outcome was
observed and sustained. Phase 4 is the next step after that: using the ledger's own history to
change what the CEO is *allowed* to do next — resource allocation, its own decision-making
behavior, and (bounded) autonomous execution. All three of those are real increases in blast
radius, so all three stay behind explicit human approval in this design, exactly as the existing
`closed-loop-improvement.ts` initiative pipeline already requires for behavioral changes.

## Why this is deferred, not built

At the time this document was written, `summarizeRecommendationLedger()` and
`listOpenRecommendationsForVenture()` had zero rows to query in production — the ledger fields
(`strategyId`, `ventureId`, `accountableLeaderId`, `reviewAt`) were added in Phase 1 of this same
change and no recommendation recorded before that point carries them. Building governance logic
that *reacts* to ledger history before the ledger has history means the thresholds, ceilings, and
kill-switch conditions below would be guessed rather than calibrated. The explicit instruction
governing this work was to ship Phases 1-3 fully wired and to leave Phase 4 as a scoped design —
that is what this document is.

## Prior art this design extends (not duplicates)

Three systems already exist and already solve pieces of what an external review proposed as new
infrastructure. Phase 4 is written as extensions to these, not replacements:

- **`src/lib/autonomy-graduation.ts`** — already has `AutonomyLevel`
  (`PROPOSED → ASSISTED → SUPERVISED → AUTONOMOUS`), `ActionClass`
  (`OBSERVE/LOW_RISK/MEDIUM_RISK/HIGH_RISK/IRREVERSIBLE`), immutable per-class ceilings
  (`ACTION_CLASS_CEILINGS` — `IRREVERSIBLE` cannot exceed `ASSISTED`, ever), and an owner-signed
  approval-token challenge/response flow (`createFirstHighRiskApprovalChallenge` /
  `approveFirstHighRiskGraduation`) for the first graduation into a higher-risk class. It already
  requires `businessOutcomesVerified > 0` and zero `businessOutcomeRegressions` before anything can
  reach `AUTONOMOUS` — this is the exact "sustained outcome, not just task completion" gate Phase 4
  needs, and it already reads from the same sustained-outcome signal
  (`ceo-sustained-outcome.ts`) that `closeRecommendationWithSustainedOutcome()` now writes into the
  ledger.
- **`src/lib/closed-loop-improvement.ts`** — already has a `proposed → simulated → approved →
  active → measuring → verified/rejected/rolled_back` initiative lifecycle with a hard gate
  (`applyInitiative` throws unless `status === 'approved'`) and a named human approver + reason
  recorded on every approval. This is the shape a "self-adjusting executive behavior" proposal
  should reuse, not reinvent as a new status enum.
- **`src/lib/ceo-continuous-loop.ts`** + **`architecture-integrity-contract.ts`** — already has
  `ADAPT → EVOLVE → REGRESSION_TEST` stages in `LOOP_TRANSITIONS`, each marked `failClosed: true`
  with an explicit `proofRequirement` (`ADAPT→EVOLVE` requires "approval is explicit for
  behavioral changes"; `EVOLVE→REGRESSION_TEST` requires "simulation plan exists"). Every
  recommendation already drives this state machine via `startContinuousLoop()`. Phase 4's gates
  are additional `proofRequirement` checks at these existing transitions, not a parallel state
  machine.

## Scope: three capabilities, each independently gated

### 4a. Governed resource allocation

**What it would let the CEO do:** propose reallocating a bounded resource (marketing spend across
ventures, compute budget across missions) based on which recommendations' ventures show sustained
positive outcomes in the ledger vs. sustained regressions.

**What it would NOT do:** move real money. `toolResourceAllocation` (`agent007-extensions.ts`) is
today an LLM analysis tool that reads `MarketingCampaign` rows and returns a recommendation
string — it has no write path to any payment or budget system, and this design does not add one.

**Proposed shape (schema, not applied):**
```ts
interface ResourceAllocationProposal {
  proposalId: string
  actionClass: 'MEDIUM_RISK'            // ceiling: SUPERVISED (autonomy-graduation.ts) — never AUTONOMOUS
  basis: {
    ventureId: string
    recommendationIds: string[]         // explicit correlation only, per the ledger's closure discipline
    sustainedOutcome: boolean           // from closeRecommendationWithSustainedOutcome()
  }
  proposedDelta: { resource: 'marketing_budget' | 'compute_budget'; ventureId: string; deltaPct: number }
  status: 'proposed' | 'approved' | 'applied' | 'rejected'
  approval: { required: true; approvedBy: string | null; approvedAt: string | null }
}
```
**Gate:** `applyResourceAllocationProposal()` would throw unless `status === 'approved'` AND the
proposal's `actionClass` is within `getActionClassCeiling('MEDIUM_RISK')` (currently `SUPERVISED`,
meaning a human approves every single application — `SUPERVISED` is not a standing grant).
Reusing `assertActionClassWithinCeiling` from `autonomy-graduation.ts` means this inherits that
system's ceiling, not a new one invented for this feature.

### 4b. Self-adjusting executive behavior

**What it would let the CEO do:** when the ledger shows a repeated pattern (e.g., recommendations
with a particular `responseAction` or missing `accountableLeaderId` correlate with sustained
regressions), propose a change to its own decision-making defaults (e.g., "require
`accountableLeaderId` before `responseAction: 'decide'` for `ventureId`s with 2+ prior
regressions").

**Reuses `closed-loop-improvement.ts` directly** — this is exactly what `ImprovementInitiative`
already models. No new lifecycle is proposed. The only addition is a new initiative `source` value
(`'executive_decision_ledger'`) and a new `targetMetric` derived from
`summarizeRecommendationLedger()`/`listOpenRecommendationsForVenture()` instead of the existing
mission-telemetry metrics. `createInitiative()` → `simulateInitiative()` →
**human `approveInitiative(initiativeId, approver, reason)`** → `applyInitiative()` →
`measureInitiative()` → `resolveInitiative('KEEP' | 'ROLLBACK', reason)` is unchanged. The existing
hard gate (`applyInitiative` throws if not `'approved'`) means this design adds zero new
enforcement code — it only adds a new evidence source feeding an existing gate.

### 4c. Bounded autonomous decision execution

**What it would let the CEO do:** for a narrow, pre-approved class of recommendation (e.g.,
`ventureId` has ≥3 consecutive sustained-positive closures and zero regressions, per
`listOpenRecommendationsForVenture` + ledger history), skip the human-approval step for the *next*
recommendation of the same `responseAction` type on that same venture, still fully logged and still
reversible.

**This is the one that actually increases autonomous authority**, so it gets the most conservative
gate of the three:

- **Ceiling:** `assertActionClassWithinCeiling('HIGH_RISK', 'SUPERVISED')` — per
  `ACTION_CLASS_CEILINGS`, `HIGH_RISK` can never exceed `SUPERVISED`. This design proposes no
  change to that ceiling. "Bounded autonomous execution" in this design means *supervised*
  execution with a standing pre-approval, not `AUTONOMOUS` in the `autonomy-graduation.ts` sense.
- **Standing pre-approval, not blanket autonomy:** the owner would approve a specific, narrow
  `AutonomousExecutionGrant` (below), not a general "trust the CEO" toggle. Every grant is scoped
  to one `ventureId` + one `responseAction` value and expires.
- **Kill-switches** (all pre-existing mechanisms, reused, not invented):
  1. `businessOutcomeRegressions > 0` for the granted `ventureId` immediately revokes the grant
     (checked at the top of the execution path, before the ledger write — fail closed).
  2. The grant carries `expiresAt`; an expired grant is inert, no execution proceeds. No silent
     renewal — a new grant requires a new explicit approval.
  3. `IMMUTABLE_ACTION_CLASS_CEILINGS` in `autonomy-graduation.ts` is marked immutable for a
     reason: nothing in this design proposes changing it, so even a compromised or buggy grant
     cannot push execution past `SUPERVISED`.
  4. Every autonomous execution under a grant still writes a normal `CeoRecommendation` +
     `ExecutionReceipt` through the existing write boundary in `route.ts` — it skips the *human
     click*, not the *audit trail*. There is no execution path in this design that writes state
     without a corresponding ledger entry.

**Proposed shape (schema, not applied):**
```ts
interface AutonomousExecutionGrant {
  grantId: string
  ventureId: string
  responseAction: string                 // e.g. 'decide' — scoped, not "any action"
  actionClass: 'HIGH_RISK'               // ceiling: SUPERVISED, immutable
  grantedBy: string                      // owner user id
  grantedAt: string
  expiresAt: string                      // required, no indefinite grants
  basisRecommendationIds: string[]       // the sustained-positive closures that justified the grant
  revokedAt: string | null
  revokedReason: string | null
}
```

## What Phase 4 explicitly does not do

- Does not add a payment, transfer, or budget-write API. 4a stays a proposal-and-approve flow over
  the existing (read-only today) resource-allocation analysis.
- Does not change `IMMUTABLE_ACTION_CLASS_CEILINGS`. `HIGH_RISK`/`IRREVERSIBLE` ceilings are not
  touched by this design.
- Does not let the ledger auto-select which recommendation to close or which grant to exercise.
  Every gate above requires an explicit `recommendationId`/`ventureId`, following the same
  discipline already enforced in `closeRecommendationWithSustainedOutcome()`.
- Does not remove or bypass any existing approval mechanism (`approveInitiative`,
  `approveFirstHighRiskGraduation`). It adds new inputs to those, never a bypass path.
- Does not get implemented in this change. This file is the entire Phase 4 deliverable for now.

## Trigger for building it for real

Build 4b first (lowest risk — it reuses `closed-loop-improvement.ts` verbatim) once
`summarizeRecommendationLedger()` shows a non-trivial `total` in production with at least a few
`overdueReview: 0` closures, so the initiative's proposed defaults are calibrated against real
decisions rather than zero. Build 4a once a real budget-write API exists to reallocate into (there
isn't one today). Build 4c only after 4b has run through at least one full
`propose → approve → apply → measure → keep-or-rollback` cycle against real ledger data, so the
"3 consecutive sustained-positive closures" threshold in the grant schema is chosen from an actual
distribution instead of guessed.
