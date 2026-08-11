# Revenue Foundation Closure Contract

## Revenue truth

Verified revenue is based on processor-backed `Transaction` rows with `status = succeeded`. Checkout intent, pipeline value, strategy estimates, customer intent, and other projections are not verified revenue.

## Stripe invariants

1. Stripe webhook signatures are required.
2. Paid checkout requires explicit Agent007 owner metadata.
3. Transaction uniqueness is enforced by `(provider, providerTxId)`.
4. Sale and refund ledger references are deterministic.
5. Replayed webhook deliveries must not create duplicate derived income entries when the reference already exists.
6. A transaction may exist even when downstream fulfillment fails; fulfillment is recorded as retryable state rather than changing payment truth.
7. Duplicate webhook delivery may retry incomplete fulfillment, but a transaction marked fulfillment-complete is not fulfilled again.
8. Refunds create a deterministic negative derived ledger reference and mark the processor transaction refunded.

## Reconciliation invariants

Revenue execution reconciliation requires an explicit correlation ID shared by the execution evidence and processor transaction payload. Recipient email and timestamp alone are insufficient causal evidence.

## Hosting independence

Revenue truth and reconciliation are application-domain concerns. Processor, storage, email, and hosting integrations must remain replaceable adapters rather than sources of business truth.

## Closure gate

The Revenue Foundation workstream is closed only after the revenue-integrity tests and targeted lint pass. Live payment/processor verification is a separate external activation gate.
