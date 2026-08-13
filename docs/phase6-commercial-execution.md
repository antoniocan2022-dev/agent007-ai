# Phase 6 — Commercial Integration & Execution Platform

Phase 6 is the shared external-execution layer for Revenue Recovery, Small Business Operations Kit, and Career Command.

## Control path

`CEO → VID → business leader → specialist → Phase 6 capability → provider adapter → external system → verified outcome → Commercial Event Ledger → Portfolio Intelligence`

## Guarantees

- Tenant and business boundaries are enforced before execution.
- Only opaque credential references are persisted by the Phase 6 layer.
- Every material external action is delegated-authority gated and audited.
- Execution is idempotent and persisted through the existing Commercial Control Plane workflow ledger.
- Retry attempts are bounded and terminal failures are durable.
- Provider adapters explicitly declare capabilities and supported environments.
- Webhook ingestion is signed, idempotent, normalized, and linked to commercial events.
- Transport success is not treated as business success when verification is required.
- Sandbox execution is available without producing live customer-facing side effects.
- Provider execution outcomes feed observability for executive and portfolio intelligence.

## Team ownership

Engineering Leader (`forge`) owns the Phase 6 execution pod: integration engineering, automation engineering, credential lifecycle, webhook reliability, execution reliability, provider observability, and external-action governance.

Product Leader (`vertex`) owns the platform boundary and architecture; VID and the three business leaders own commercial intent and delegated outcomes.

## Deployment boundary

Phase 6 source and verification live in GitHub. No Vercel deployment or production credential installation is part of this implementation phase.

## Provider expansion rule

New providers must implement the canonical `CommercialProviderAdapter` contract and must not create a parallel execution path. Provider-specific credentials stay outside Git source; the adapter receives only an opaque credential reference and resolves secrets through an approved runtime mechanism.
