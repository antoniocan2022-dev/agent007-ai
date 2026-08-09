# Outreach Executor Contract

`prepare_outreach` is executable only through the exact registered outreach executor. The SMTP adapter is disabled by default and requires explicit deployment configuration.

The adapter validates recipient, subject, body, sender, and durable idempotency identity before contacting the provider. Provider acceptance is recorded as an execution result; it is never treated as financial verification.
