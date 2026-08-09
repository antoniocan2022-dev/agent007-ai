# Governed SMTP Outreach Executor

Agent007's first concrete revenue executor is a provider-specific SMTP adapter for the `prepare_outreach` capability.

## Safety contract

- Disabled by default.
- Requires explicit deployment configuration to enable.
- Requires persisted recipient, subject, and body content in the approved action payload.
- Carries the durable idempotency key into the outbound message metadata.
- Returns provider acceptance metadata for auditability.
- Never marks revenue as verified.
- Missing credentials or invalid payloads fail closed.

## Required configuration

`REVENUE_OUTREACH_EXECUTOR_ENABLED=true`

`REVENUE_OUTREACH_SMTP_HOST`, `REVENUE_OUTREACH_SMTP_PORT`, `REVENUE_OUTREACH_SMTP_SECURE`, `REVENUE_OUTREACH_SMTP_USER`, `REVENUE_OUTREACH_SMTP_PASS`, and `REVENUE_OUTREACH_FROM`.

## Payload contract

`payload.to`, `payload.subject`, and either `payload.text` or `payload.html` are required. Optional `payload.from` overrides the configured sender only when explicitly supplied by the approved action.

Execution success means the SMTP provider accepted the message submission. It does not mean the recipient opened the message, responded, purchased, or generated verified revenue.
