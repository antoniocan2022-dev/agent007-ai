# Agent007 AI

> Autonomous AI super-agent with 289+ tools, 20 specialists (12 built-in + 8 custom), full self-repair + autonomous issue resolution.

[![Deploy on Vercel](https://img.shields.io/badge/Deploy%20on-Vercel-black.svg)](https://vercel.com/new)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black.svg)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://www.typescriptlang.org)
[![289+ Tools](https://img.shields.io/badge/Tools-289+-green.svg)](#tools)
[![20 Specialists](https://img.shields.io/badge/Specialists-20-purple.svg)](#sub-agents)

## 🚀 Quick Deploy

```bash
unzip agent007-ai.zip -d agent007-ai
cd agent007-ai
bun install
cp .env.example .env  # edit with your secrets
bunx prisma generate && bunx prisma db push
bash scripts/deploy-vercel.sh
```

## 🧭 Autonomy 95 Program

Agent007's autonomy is measured by **verified mission outcomes**, not tool count. The Autonomy 95 program targets 95–97% measured operational autonomy across mission ownership, decision-making, execution, verification, recovery, learning and governance.

Development is performed in GitHub. Production deployment is a separate controlled action and requires explicit owner authorization.

See:
- `docs/AGENT007-AUTONOMY-95-PROGRAM.md` — program, KPIs, reliability gates and completion criteria.
- `docs/SYSTEM-CAPABILITY-MANIFEST.md` — canonical semantic capability contract.
- `src/lib/autonomy/` — pure autonomy scoring and authority-policy primitives.

## 🗄️ Database Setup (CRITICAL for performance)

Agent007 uses Postgres via Prisma. On Vercel serverless, you MUST use a
**connection pooler** — otherwise every cold start pays 1-3 seconds of TLS
handshake latency and risks exhausting free-tier connection limits.

### Provider-specific setup

**Neon** (recommended, free tier):
1. Create a project at https://neon.tech
2. Copy the **pooled** connection string (uses port `6543`, hostname ends in `-pooler.region.aws.neon.tech`)
3. Set `DATABASE_URL=postgres://user:pass@ep-xxx-pooler.region.aws.neon.tech/dbname?sslmode=require`

**Supabase** (free tier):
1. Create a project at https://supabase.com
2. Go to Settings → Database → Connection string → **Transaction mode** (pooled)
3. Append `?pgbouncer=true&connection_limit=1` to the URL
4. Set `DATABASE_URL=postgres://...supabase.co:6543/postgres?pgbouncer=true&connection_limit=1`

**Vercel Postgres** (auto-pooled):
1. Vercel Dashboard → Storage → Create Postgres
2. Connect to project — `DATABASE_URL` is set automatically (already pooled)

### How to verify your pooler is working

After deploy, check the Vercel function logs on a cold start. You should see:
```
[db] DATABASE_URL is Postgres-compatible ✅
[db] DATABASE_URL appears to use a pooler ✅
```

If you see the warning instead:
```
[db] WARNING: DATABASE_URL does not appear to use a connection pooler.
```
…then switch to the pooled connection string from your provider.

### Why this matters

Without a pooler, every cold serverless instance:
- Opens a direct TCP+TLS connection to Postgres (~500ms-1s)
- Counts against your provider's direct-connection limit (Neon free = 5, Supabase free = 20)
- Can exhaust connections when 3+ instances cold-start simultaneously (common on dashboard load)

With a pooler, connections are reused across instances — cold-start DB cost drops to ~50-150ms.

## 🧰 Tools (289+)

### Base Tools (15)
Web search, page reader, image gen, vision, code exec, memory store/recall, file read, Wikipedia, free APIs, KB search, source read, file write, HTTP fetch, Python exec

### Business Infrastructure (24)
Real-time monitor, business infrastructure, service delivery, financial controls, CRM, marketing automation, partnership network, autonomous revenue, predictive BI, scalable infrastructure, mission tracker, content QA, multi-format generation, personalization, content performance, advanced billing, dunning, multi-currency, fraud prevention, advanced chatbot, proactive support, market intelligence, strategic planning, resource allocation, risk management, predictive analytics V2, advanced reporting

### Self-Repair (10)
System health check, DB integrity, API endpoint test, tool registry audit, cache clear, session recovery, error log analyzer, auto-fix, backup create, restore from backup

### Autonomous Resolution (12)
Issue detector, root cause analyzer, patch designer, patch applier, fix verifier, learning recorder, autonomous resolver, log tailer, file inspector, config auditor, dependency checker, full system audit

### Safety + Reliability (26)
Staging manager, regression tests, canary deployment, rollback manager, cost guard, cascade detector, multi-provider LLM router, uptime monitor, backup scheduler, DR planner, DB replication, health canary, secrets rotator, rate limiter, CSRF auditor, audit hardener, 2FA upgrader, multi-tenancy auditor, lazy loader, cache manager, CDN optimizer, migration validator, reality check, ToS monitor, human action router, license blocker

### Sub-Agent Enhancements (120)
10 sub-agents × 12 tools each

### Phase 3 Optimization (64)
4 areas × 16 tools each

### Developer Tools (12)
Code quality audit, test generator, bug detector, refactoring engine, dependency analyzer, CI/CD builder, environment setup, DB migration, performance profiler, bundle optimizer, SSR/hydration fixer, API optimizer

### Communication (3)
Send communication (SMS/WhatsApp/Email), check inbound commands, execute inbound commands

## 🤖 Sub-Agents (20 specialists)
AURORA, VERTEX, QUANTUM, SCOUT, HUNT, FORGE, QUILL, PRISM, PULSE, ECHO, LEGAL, THE BANKER, TRADER, Cybersecurity A (Red Team), Cybersecurity R (Blue Team), SEO_MASTER, Developer, STRATEGIST, plus 2 additional custom/overlay specialist slots managed through the subagent registry.

## 🔐 Security
- NextAuth + 2FA (TOTP/SMS/WhatsApp)
- bcrypt password hashing
- Rate limiting on auth endpoints
- CSRF protection
- Audit log with hash chain
- Licensed activity blocker (legal/medical/tax)
- Autonomy Governor for bounded authority decisions

## 📊 Prisma Models
Conversation, Message, Memory, User, UserSetting, IncomeEntry, Transaction, KnowledgeDoc, KnowledgeChunk, Schedule, NotificationLog, PendingManageAction, CustomSubagent, AuditLog, TwoFactorSecret, PhoneConfig, IncomingCommand, BankAccount, PayPalAccount, ApiKey, Customer, MarketingCampaign, Partnership, BusinessStrategy, MissionTracker, ServicePackage, Opportunity, Prediction, SystemHealth, MLModel, RiskRegister, ComplianceCheck, ContractDraft, plus the additional models defined in `prisma/schema.prisma`.

## 📝 License
Private — All rights reserved.
