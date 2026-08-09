# Revenue Execution Lifecycle

`prepare -> approve -> execute -> verify`

- **prepare:** persist a user-scoped, idempotent execution intent.
- **approve:** explicit operator authorization; no external side effect.
- **execute:** only a registered, enabled capability-specific executor may run the action.
- **verify:** processor-backed transaction evidence determines whether revenue is real.

The executor layer fails closed when an adapter is missing or disabled. This prevents approval from becoming an implicit side effect and prevents Agent007 from claiming revenue from forecasts, generated text, or executor completion alone.
