# Agent007 Architecture Continuity Map

## Purpose

This is the canonical navigation map for future Agent007 work. It prevents parallel implementations, repeated fixes, and context loss between conversations.

## Source-of-truth hierarchy

### Executive / conversational control
- `src/lib/ceo-cognitive-lifecycle.ts` — request-level CEO cognition, verification, degraded mode, and final quality gate.
- `src/lib/ceo-cognitive-kernel.ts` — decision-plan construction only; it does not execute venture operations.
- `src/lib/ceo-presenter.ts` — executive presentation and evidence-aware output.
- `src/lib/orchestrator.ts` — governed mission/tool runtime coordination.

### Governance / control plane
- `src/lib/architecture-control-plane.ts` — delegation hierarchy, artifact ledger, mission state transitions, business outcomes, and Venture control contracts.
- `src/lib/autonomy/autonomy-manager.ts` — canonical autonomy heartbeat/lease boundary.
- `src/lib/venture-autonomy-control.ts` — Venture readiness and autonomy gating.

### Commercial system of record
- Prisma relational tables remain authoritative for `BusinessUnit`, `Venture`, `Customer`, `Opportunity`, `Transaction`, `MarketingCampaign`, `IncomeEntry`, `Subscription`, and `Invoice`.
- `src/lib/venture-commercial-foundation.ts` — the canonical Venture/commercial relational adapter and idempotent Venture identity boundary.
- `src/lib/customer-success.ts` — the canonical venture-scoped Customer Success lifecycle.
- `src/lib/billing-lifecycle.ts` — subscription/invoice lifecycle using the existing Transaction ledger and verified settlement evidence.
- `src/lib/transaction-evidence-integrity.ts` — canonical check that a payment claim resolves to a real succeeded relational Transaction.

### Venture operation / intelligence
- `src/lib/venture-operation-loop.ts` — bounded Venture heartbeat after the canonical Autonomy Manager lease; the supplied owner must resolve to a registered CEO identity.
- `src/lib/operational-kpi-engine.ts` — operational KPI snapshot, combining durable mission/artifact/outcome evidence with relational commercial state; revenue/refunds are reconciled to real Transactions and mission storage failures fail closed.
- `src/lib/mission-money-bridge.ts` — mission → real succeeded Transaction → canonical BusinessOutcome attribution.
- `src/lib/portfolio-commercial-intelligence.ts` — relational adapter feeding Portfolio Intelligence.
- `src/lib/portfolio-intelligence-engine.ts` — portfolio snapshot and optimization decisions; it must not become a second commercial source of truth.
- `src/lib/venture-template-validation.ts` — proof gate for reusable Venture Factory certification; mission-to-money evidence must reconcile to real Transactions.
- `src/lib/venture-factory.ts` — structural Venture shells only; factory output is not production proof.

### Executive-to-Venture bridge
- `src/lib/ceo-venture-state.ts` — one read-only adapter from the conversational CEO lifecycle into existing Venture OS state. It reads the canonical relational Venture/commercial snapshot, operational KPI engine, and Venture operation checkpoint. It does not create a second Venture registry or KPI engine.

## Canonical data flow

```text
User / CEO
  ↓
CEO Cognitive Lifecycle
  ↓
CEO Venture State Bridge (read-only when venture-specific)
  ↓
Venture OS + relational commercial source of truth
  ↓
Customer Success / Mission / verified Artifact
  ↓
Real succeeded Transaction
  ↓
Invoice / Subscription
  ↓
Business Outcome ledger
  ↓
Operational KPI / Portfolio Intelligence
  ↓
CEO optimization / decision
```

## Trust boundaries

A `transaction_id` artifact is not sufficient by itself. Commercial revenue attribution must reconcile the artifact against the real relational `Transaction` row and require a succeeded status, matching Venture, positive amount, and valid currency.

A `Customer.status` value is not proof of value realization. Customer Success state is the lifecycle evidence.

A portfolio score is not proof of revenue. Portfolio revenue must originate from venture-scoped commercial records.

A Venture Factory blueprint is not proof of a successful Venture. Certification requires real commercial lifecycle evidence.

A paid invoice is not proof by status alone. It must reconcile to the same-venture customer and a succeeded Transaction with matching amount/currency.

A KPI refund is not proof by ledger row alone. It must reference a real succeeded Transaction, use a valid positive amount, and not exceed the originating transaction amount.

## Anti-duplication rules

1. Extend the existing canonical module before creating a new subsystem.
2. New adapters may connect domains, but they must not create a parallel source of truth.
3. Every new persistent identity must have one canonical key and explicit ownership/venture scope.
4. Every new financial claim must identify its originating Transaction or another independently verifiable source.
5. Every new CEO capability must state its source-of-truth modules and whether it is read-only or mutating.
6. Idempotent identity functions must not silently change owner, production state, or lifecycle status on re-entry.
7. KPI engines must fail closed rather than fall back to legacy/synthetic state when a durable source is unavailable.
8. CI must fail when a second registry, payment ledger, portfolio source, or Venture identity model is introduced.

## Change discipline for future conversations

Before modifying code, record the target domain, canonical source-of-truth files, existing integration points, and tests that protect them. After modification, update this map only when a new canonical boundary is intentionally introduced. Do not create another architecture map for the same system.
