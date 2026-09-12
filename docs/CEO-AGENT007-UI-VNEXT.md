# CEO_AGENT007 UI vNext

## Objective

Make Agent007 feel like an autonomous executive operating system rather than a technical AI dashboard. The primary experience is a clean CEO workspace; internal machinery remains available but is not exposed by default.

## Primary navigation

1. CEO_AGENT007 — executive conversation and command center
2. Missions — all active, planned, blocked and completed missions
3. Businesses — ventures, opportunities, experiments, customers, sales and growth
4. Finance & Analytics — revenue, expenses, cash, profit, pipeline, ROI and forecasts
5. Organization — CEO, divisions, leaders, agents, capabilities, resources and governance
6. Automation — schedules and recurring workflows
7. System — settings, integrations, security, backups, disaster recovery, health and audit

## CEO screen

The first screen must be as simple as a modern AI assistant:

- Title: `CEO_AGENT007`
- Primary prompt: `What should we accomplish today?`
- Conversation history hidden/collapsed by default
- Left history drawer with Today / Yesterday / This Week / older groups
- Right executive-context rail collapsed or minimal by default
- Attach control labeled `Attach anything`
- Keyboard-first message composer
- No technical sub-agent list, capability grid or engineering telemetry in the default view

## Right context rail

Default sections:

- Executive status
- Current mission
- Revenue
- Business portfolio
- Active missions
- Risks
- Active specialists
- Knowledge and memory

Technical telemetry moves to System/Operations.

## Conversation history

The history drawer must preserve the current conversation grouping and actions while becoming visually quieter. Conversation titles remain visible and are available as native hover titles for truncated entries.

## Attachment architecture

The product target is support for arbitrary business files up to 100 GB per object. This must not be implemented as a normal serverless chat multipart upload. The intended architecture is:

Browser → Upload Manager → Object Storage → validation/security → extraction/indexing → Knowledge Workspace → CEO context.

Large files require resumable/multipart object-storage uploads, progress, retry/resume, checksum verification and a file-processing state machine. The chat API should receive file references, not 100 GB payloads.

### OCI implementation status

The current branch now contains the first production-oriented storage foundation:

- `src/lib/oci-s3-signer.ts` — AWS SigV4-compatible signing for OCI Object Storage S3 compatibility.
- `src/app/api/storage/multipart/route.ts` — initiate, presign-part, complete and abort controls.
- `src/lib/oci-large-upload.ts` — browser multipart uploader with 256 MiB parts, four concurrent workers and retry handling.
- Maximum object target: 100 GB.
- Maximum multipart parts: 10,000.
- Default OCI namespace fallback: `axpyeqhqzuof`.

Expected server environment:

- `AWS_ACCESS_KEY_ID` — OCI Customer Secret Key access key.
- `AWS_SECRET_ACCESS_KEY` — OCI Customer Secret Key secret.
- `CHAT_ATTACHMENTS_S3_BUCKET` — **recommended**: a separate OCI Object Storage bucket for user attachments, without a retention/immutability lock (see warning below). Falls back to `DR_BACKUP_S3_BUCKET` if unset.
- `DR_BACKUP_S3_BUCKET` — OCI Object Storage bucket (DR backups; also the fallback for attachments if `CHAT_ATTACHMENTS_S3_BUCKET` is not set).
- `DR_BACKUP_S3_REGION` — `ca-montreal-1`.
- `DR_BACKUP_S3_ENDPOINT` — optional; if omitted, the namespace-based OCI S3 endpoint is derived.
- `DR_BACKUP_S3_NAMESPACE` — optional namespace override; defaults to `axpyeqhqzuof` for this deployment configuration.

**Warning — bucket immutability:** `DR_BACKUP_S3_BUCKET` is configured with a retention/immutability
policy for disaster-recovery purposes (`.github/workflows/dr-offsite-backup.yml`: "Immutability is
provided by the configured storage retention policy"). Until `CHAT_ATTACHMENTS_S3_BUCKET` is
provisioned as a separate, non-locked bucket, user attachment objects (and aborted/incomplete
uploads) land in that same immutable bucket and may not be deletable for the retention period —
this is a real data-hygiene and potential compliance concern, not yet resolved. Provisioning a
dedicated attachments bucket without a retention lock is recommended before this feature carries
meaningful traffic.

### Chat composer wiring — implemented

The chat composer now routes files above 8 MB (and up to a 10 GB cap) through the OCI multipart
uploader instead of rejecting them:

- `src/lib/oci-large-upload.ts` also exposes `getOciDownloadUrl()` (backed by a new `download`
  action on `src/app/api/storage/multipart/route.ts`) for retrieving a completed upload.
- `AttachmentMeta.remote` (`src/lib/tools.ts`) carries the bucket/key/checksum reference for a
  remote-only attachment instead of inlining its content.
- The CEO's context is told explicitly when an attachment is remote-only and has **not** been
  read or analyzed (`src/lib/agent.ts`'s `attachmentContextSuffix`, and the vision tool's
  honest refusal in `src/lib/tools.ts`) — it must never guess at or fabricate remote file
  contents.

What this does **not** yet include, per the architecture above: extraction/indexing of remote
file content into the Knowledge Workspace, so the CEO still cannot read a remote attachment's
contents directly — only that it exists, its name, and its size. That remains future work.

Also not yet done: a live, end-to-end round-trip test (initiate → upload → complete → verify →
download → abort/cleanup) against the real deployed OCI credentials. The code paths are unit
tested with mocked OCI responses; someone with access to the deployed environment should run
one real large-file upload after this ships, per the acceptance criterion below.

## Business architecture

The CEO must operate the closed loop:

Opportunity → validation → decision → resource allocation → build → launch → customer acquisition → transaction → fulfillment → collection → reconciliation → measurement → learning → reinvestment.

The UI should make this loop visible through Missions, Businesses and Finance without exposing the underlying tool registry.

## Migration principles

- Preserve existing store IDs and API contracts where possible.
- Rename and regroup user-facing concepts before changing internal architecture.
- Keep mission-active as an internal/child state of Missions rather than a primary navigation item.
- Keep VID as an organizational capability/division; expose its business outcomes under Businesses.
- Keep existing technical telemetry available under System/Operations.
- Do not claim real revenue until transactions are externally verified and reconciled.
- Do not claim OCI backup success until a run completes upload and remote object verification.

## Implementation phases

### Phase 1 — UX shell — implemented on this branch

- CEO_AGENT007 branding
- executive navigation
- simplified left conversation drawer
- executive right rail
- cleaner chat composer
- preserve existing mission/chat functionality

### Phase 2 — Business surfaces — next

- Businesses portfolio
- opportunity pipeline
- customer/sales surface
- Finance & Analytics executive metrics
- mission-to-business linkage

### Phase 3 — Large-file knowledge system — storage foundation and chat wiring implemented

- OCI S3-compatible multipart control API
- browser multipart uploader
- resumable/retry-ready upload flow
- chat composer wired to the uploader (10 GB cap advertised; 100 GB object target remains available server-side)
- indexing pipeline — not started
- knowledge workspace — not started

The large-file feature becomes **fully production-verified** only after a real OCI integration test completes on the deployed environment: initiate → upload multiple parts → complete → HEAD/GET verification → checksum/size verification → download → cleanup/abort test. Until that real round-trip runs against production, treat it as code-complete and unit-tested rather than field-verified.

### Phase 4 — Reliability

- backup status in System
- OCI upload verification
- restore verification
- health and audit surfaces

## Acceptance criteria

- A new user immediately understands that the first page is the CEO.
- Primary navigation exposes business outcomes, not implementation details.
- Conversation history can be opened without permanently consuming the main canvas.
- Executive context can be opened without showing a wall of telemetry.
- Existing authentication, missions, conversations and memory continue to work.
- Large-file support is advertised in the chat composer only up to the 10 GB cap that has real, tested code behind it; the full 100 GB server-side ceiling is not advertised until a live production round-trip test has run and extraction/indexing exists.
- Vercel preview/production verification must be green before this branch is merged.
