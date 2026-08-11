# Hosting Independence v1

## Objective

Agent007 application and business logic must not require Vercel to operate. Hosting-specific capabilities are adapters selected at runtime.

## Provider-neutral boundaries

### Compute lifecycle

- `src/lib/runtime/background-tasks.ts` defines the application contract for deferred work.
- `src/lib/runtime/vercel-background.ts` is a Vercel implementation only.
- `instrumentation.ts` selects the Vercel implementation only when the runtime identifies Vercel.

### Public application URL

- `src/lib/runtime/public-base-url.ts` is the canonical resolver.
- Production requires `PUBLIC_APP_URL` or `NEXTAUTH_URL`.
- There is no hardcoded provider hostname in the resolver.
- Request handlers may use the trusted request origin only when explicit application configuration is absent and the environment is non-production.

### Object storage

- `src/lib/storage/object-storage.ts` defines the host-neutral storage contract.
- `src/lib/storage/vercel-blob.ts` is an implementation adapter only.
- Application routes must never import a hosting storage SDK directly.
- Production download requests fail closed when no storage adapter is configured.

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

## Current limitation

Some legacy integrations still contain compatibility fallbacks that reference the historical Vercel deployment URL. Startup now initializes `NEXTAUTH_URL` from the canonical public URL resolver, so configured deployments do not rely on that fallback. Those legacy literals remain a separate cleanup item and must not be re-used for new code.

## Verification

Hosting Independence v1 is repository-complete when:

1. portability contract tests pass;
2. TypeScript and targeted lint pass;
3. core checkout/download routes contain no direct hosting SDK imports;
4. Vercel implementations exist only under explicit adapter/bootstrap boundaries;
5. no production deploy is required to prove the application architecture is provider-neutral.

Production deployment verification is intentionally deferred while Vercel is blocked.
