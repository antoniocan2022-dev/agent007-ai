# Revenue Reconciliation

Agent007 treats outbound execution and revenue as separate facts.

1. SMTP acceptance is delivery evidence only.
2. A succeeded `Transaction` is the source of truth for verified revenue.
3. Reconciliation may enrich a completed outreach action with transaction evidence.
4. Reconciliation never retries an external side effect.
5. Matching requires the same operator, recipient email, and a transaction created after the outreach action.
6. Delivery is never described as delivered unless the provider supplies delivery evidence.
