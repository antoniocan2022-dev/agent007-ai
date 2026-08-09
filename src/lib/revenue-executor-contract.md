# Revenue Executor Contract

## Purpose

Define the boundary between an approved revenue execution intent and an authorized external side effect.

## Required invariants

1. **Approval is not execution.** An approved `PendingManageAction` remains an intent until an authorized executor accepts it.
2. **Closed-world execution.** Only an executor registered for the exact revenue action may execute it.
3. **Capability-specific adapters.** Outreach, checkout, fulfillment, and offer preparation must have independent adapters and authorization contracts.
4. **Idempotency.** Every adapter must preserve the request idempotency key across retries and external calls.
5. **Auditability.** Execution attempts must record executor identity, action ID, start/end state, external reference, and failure reason.
6. **Financial truth.** An executor must never mark revenue as verified merely because an external action succeeded. Processor-backed transaction evidence remains authoritative.
7. **Failure safety.** Missing credentials, disabled adapters, ambiguous external responses, and retry exhaustion must fail closed rather than guessing success.

## Current implementation state

The executor registry exists and exposes four explicit capability slots. They are disabled until concrete, authorized adapters are configured. This is intentional: Agent007 must not synthesize generic side effects or silently claim that an approved action was executed.

The next adapter work should add one capability at a time with provider-specific authorization, idempotency, response validation, and audit evidence.
