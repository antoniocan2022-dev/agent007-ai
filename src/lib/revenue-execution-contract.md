# Revenue Execution Contract

## Purpose

Define the boundary between an approved revenue execution intent and an authorized external side effect.

## Required invariants

1. **Approval is not execution.** An approved `PendingManageAction` remains an intent until an authorized executor accepts it.
2. **Closed-world execution.** Only an executor registered for the exact revenue action may execute it.
3. **Capability-specific adapters.** Outreach, checkout, fulfillment, and offer preparation require independent adapters and authorization contracts.
4. **Idempotency.** Every adapter must preserve the request idempotency key across retries and external calls.
5. **Auditability.** Execution attempts record executor identity, action ID, state transitions, external references, and failure reasons.
6. **Financial truth.** Executor completion never makes revenue verified. Processor-backed transaction evidence remains authoritative.
7. **Failure safety.** Missing credentials, disabled adapters, ambiguous responses, and retry exhaustion fail closed.

## Current state

The registry exposes four explicit capability slots. They are disabled until concrete, authorized adapters are configured. Agent007 therefore cannot synthesize a generic external side effect or silently claim that an approved action executed.
