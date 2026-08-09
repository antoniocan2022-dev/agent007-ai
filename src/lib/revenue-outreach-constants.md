# Revenue Outreach Executor

The first concrete revenue executor is an SMTP outreach adapter. It remains disabled unless `REVENUE_OUTREACH_EXECUTOR_ENABLED=true` is explicitly configured.

Required runtime configuration:

- `REVENUE_OUTREACH_EXECUTOR_ENABLED=true`
- `REVENUE_OUTREACH_SMTP_HOST`
- `REVENUE_OUTREACH_SMTP_PORT` (default `587`)
- `REVENUE_OUTREACH_SMTP_SECURE` (`true` for TLS-secure SMTP)
- `REVENUE_OUTREACH_SMTP_USER`
- `REVENUE_OUTREACH_SMTP_PASS`
- `REVENUE_OUTREACH_FROM`

The execution payload requires `to`, `subject`, and either `text` or `html`. The persisted revenue action idempotency key is carried into the message ID and audit headers. Executor success means an external email submission occurred; it does not mean revenue occurred or was verified.
