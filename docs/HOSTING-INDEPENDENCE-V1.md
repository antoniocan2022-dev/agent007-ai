# Hosting Independence v1

## Objective

Agent007 application and business logic must not require Vercel to operate. Hosting-specific capabilities are adapters selected at runtime.

## Provider-neutral boundaries

### Compute lifecycle

- `src/lib/runtime/background-tasks.ts` defines the application contract for deferred work.
- `src/lib/runtime/vercel-background.ts` is a Vercel implementation only.
- `instrumentation.ts` selects the Vercel implementation only when the runtime identifies Vercel.
- `src/lib/runtime/host-runtime.ts` is the only application-level host identity adapter; core code consumes its neutral `generic`/`vercel` contract instead of reading provider environment variables directly.

### Public application URL

- `src/lib/runtime/public-base-url.ts` is the canonical resolver.
- `src/lib/internal-url.ts` delegates to that resolver and never inspects provider-specific URL variables.
- Production requires `PUBLIC_APP_URL` or `NEXTAUTH_URL`.
- There is no hardcoded provider hostname in the canonical resolver.
- Request handlers may use the trusted request origin only when explicit application configuration is absent and the environment is non-production.

### Object storage

- `src/lib/storage/object-storage.ts` defines the host-neutral storage contract.
- `src/lib/storage/vercel-blob.ts` is an implementation adapter only.
- Application routes must never import a hosting storage SDK directly.
- Production download requests fail closed when no storage adapter is configured.

## Portability-critical audit

`scripts/hosting-independence-audit.ts` continuously checks the canonical runtime, storage, internal URL, checkout, and file-download boundaries. Outside the explicit adapter allowlist it rejects:

- `VERCEL_URL` and related Vercel public-URL environment variables;
- hardcoded `*.vercel.app` deployment URLs;
- direct imports of Vercel hosting/storage SDK packages;
- direct `process.env.VERCEL` checks.

The broader repository still contains historical diagnostic/compatibility code with provider references. Those files are outside the portability-critical closure boundary and must not be copied into new host-neutral modules. The audit is deliberately scoped to the architecture seams that determine whether a host migration requires application rewrites.

## Database

PostgreSQL + Prisma remain platform-neutral and are not replaced by Hosting Independence v1.

## External services

Stripe, SMTP/email, WhatsApp/Telegram and object storage are treated as replaceable service adapters. Their provider-specific credentials and runtime details do not belong in Mission OS or autonomy policy.

## Migration readiness

A future Railway, DigitalOcean, Cloudflare, Docker or self-hosted deployment must be able to register replacement adapters without rewriting:

- Mission OS
- Autonomy Governor
- Revenue truth/reconciliation
- CEO communications
- Disaster recovery logic
- database access layer

## Verification

Hosting Independence v1 hardening is repository-complete when:

1. the portability-critical static audit passes;
2. portability contract tests pass;
3. TypeScript and targeted lint pass;
4. checkout/download routes contain no direct hosting SDK imports;
5. Vercel implementations exist only under explicit adapter/bootstrap boundaries;
6. no production deploy is required to prove the application architecture is provider-neutral.

Production deployment verification remains an external environment gate and is not required for the repository-side portability contract.
