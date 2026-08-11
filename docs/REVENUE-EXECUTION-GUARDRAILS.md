# Revenue Execution Guardrails

Agent007's revenue engine separates planning, approval, execution, and verified revenue.

## Rules

1. `PendingManageAction` is the durable action queue for execution intent.
2. `AuditLog` records preparation and approval transitions.
3. Every revenue action is scoped to the authenticated operator.
4. Preparation validates referenced customer, service-package, and opportunity records against that operator.
5. Idempotent preparation is serialized with a transaction-scoped PostgreSQL advisory lock, preventing duplicate creation under concurrent requests.
6. The lifecycle is explicit: `pending -> approved -> executing -> done|failed`; `pending|approved -> cancelled`.
7. Approval and claim are conditional state transitions; stale or concurrent writers cannot silently advance an action twice.
8. Approval and claim perform no external outreach, payment, checkout, storage, or other provider call.
9. Completion with an external side effect requires provider evidence; verified revenue cannot be asserted without that evidence.
10. Payloads are bounded and reject common secret-bearing field names.
11. Failed actions do not retry implicitly; a new explicit approval is required.
12. No core revenue guardrail file imports a hosting-provider SDK, so the boundary remains portable across compute hosts.
13. Verified revenue remains grounded in processor-backed `Transaction` records; approval state never becomes revenue truth.

## Current actions

- `prepare_offer`
- `prepare_outreach`
- `prepare_checkout`
- `prepare_fulfillment`

These actions create durable, auditable intent. A future provider executor can consume only authorized `executing` actions and must return provider evidence through the completion boundary.

## Verification

`.github/workflows/revenue-execution-guardrails-ci.yml` is the closure gate. It runs policy unit tests, PostgreSQL-backed concurrency/lifecycle tests, TypeScript checking, and targeted lint.
