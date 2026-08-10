# Revenue Execution Guardrails

Agent007's revenue engine separates **planning**, **approval**, **execution**, and **verified revenue**.

## Rules

1. `PendingManageAction` is the durable action queue for execution intent.
2. `AuditLog` records preparation and approval transitions.
3. Every revenue action is scoped to the authenticated operator.
4. Preparation validates referenced customer, service, and opportunity records against that operator.
5. `idempotencyKey` prevents duplicate preparation for the same revenue action.
6. Approval is an explicit boundary. Approval alone never represents a sale, payment, or revenue.
7. No external outreach, checkout charge, or other consequential side effect is performed by the preparation/approval API.
8. Successful `Transaction` records from the payment processor/webhook remain the only source of verified revenue.
9. Currency conversion is not performed implicitly by the execution layer.

## Current actions

- `prepare_offer`
- `prepare_outreach`
- `prepare_checkout`
- `prepare_fulfillment`

These actions create durable, auditable intent. An authorized executor can be added later without changing the revenue truth model.
