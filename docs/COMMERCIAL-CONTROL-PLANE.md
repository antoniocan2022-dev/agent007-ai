# Agent007 Commercial Control Plane

Phase 1 defines one shared commercial control plane for the three Venture OS businesses:

- `revenue-recovery`
- `operations-kit`
- `career-command`

`shared-platform` is an infrastructure scope, not a fourth venture.

## Sources of truth

- Venture OS remains the executive venture boundary.
- Portfolio remains the business-record source of truth.
- VID remains the canonical venture-intelligence source.
- Commercial Control Plane owns tenant/customer/event/workflow/credential-reference/billing/entitlement/evidence/authority/audit records.
- Existing tools remain implementations; the capability map describes their business role and adapter gaps.

## Persistence contract

Phase 1 uses the existing Prisma `Memory` table with deterministic categories and idempotent keys. This intentionally avoids a parallel Prisma schema while the commercial model is still being proven.

Raw credentials are never stored. Credential records contain opaque `secretRef` values only.

External systems are adapter-required until a provider is connected, authenticated, tested, and assigned a capability contract.

## Autonomy contract

A business action may become autonomous only when:

1. the tenant/business scope is valid;
2. a capability contract exists;
3. delegated authority is active;
4. spend/count/channel limits are satisfied;
5. the action is auditable;
6. the result can be represented as outcome evidence.

Human approval remains required for banking, identity/KYC, legal contracts, ownership changes, borrowing, tax filings, major expenditure, payment credential changes, and other irreversible financial actions.

## Business-unit organization

VID manages three dedicated business leaders. Shared functional leaders provide intelligence, product/engineering, growth, finance, analytics, and learning capabilities.

Specialists are assigned to one business when specialized and shared across all three when the capability is reusable.

## Adapter gaps intentionally left for later phases

The Phase 1 control plane declares, but does not pretend to have production adapters for:

- CRM
- secret vault / OAuth connection management
- durable worker runtime
- payment provider
- communications provider
- analytics event sink

Those integrations require real provider credentials, external configuration, testing, and later Vercel/production work.
