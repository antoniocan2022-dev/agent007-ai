# Revenue Execution UI Integration

The Finance & Analytics executive surface now exposes the durable revenue execution queue.

## UX contract

- Pending actions are explicit execution intent, not revenue.
- Approval is an explicit operator boundary.
- Approving an action does not send outreach or charge a customer.
- Verified revenue remains processor-backed `Transaction` evidence.
- The queue is scoped to the authenticated operator by `/api/revenue-execution`.
- The UI refreshes the queue without adopting a second source of truth.

## Current states

- Pending — prepared and awaiting approval.
- Approved — approved for a future authorized executor.
- Executing / done / failed / cancelled — reserved for future executor lifecycle integration.

The UI intentionally does not expose a misleading "execute now" control until concrete adapters exist for each external side effect.
