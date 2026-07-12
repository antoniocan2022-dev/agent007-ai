# EXHAUSTIVE AUDIT — Agent007 AI Production
Generated: 2026-07-12 (live audit against https://agent007-ai.vercel.app)

## Production state at audit start

| Endpoint | Status | Issue |
|---|---|---|
| GET / | 200 | Dashboard HTML (15 KB client-rendered) |
| GET /login | 200 | Login page OK |
| GET /api/system/manifest | 200 | Returns 53 upgrades (latest = real_integrations_v3_56) |
| GET /api/system/capabilities | 200 | OK |
| GET /api/system/capabilities-download | 200 | Returns binary ZIP (works) |
| GET /api/system/zip-backup | 200 | Returns `{backups: []}` — 0 backups (Vercel /tmp ephemeral) |
| GET /api/system/backup-download | **500** | Prisma: "URL must start with `file:`" — DB URL broken |
| GET /api/system/audit | **404** | Source file exists, production build is outdated |
| GET /api/system/self-heal | 405 | Method not allowed (POST only) |
| GET /api/system/seed-agents | **500** | "Could not create or find operator user" (DB issue) |
| GET /api/subagents | **307** | Redirect to /login (auth middleware blocks) |
| GET /api/backup | **307** | Redirect to /login (auth middleware blocks) |
| GET /api/monitor/qa | **307** | Redirect to /login (CRON CANNOT AUTH — monitors broken) |
| GET /api/monitor/external | **307** | Redirect to /login (CRON CANNOT AUTH — monitors broken) |
| GET /api/health | **404** | Referenced by External Monitor but doesn't exist |
| POST /api/agent (no auth) | 307 | Auth-required (correct) |

## Critical Issues Found

### C1 — Auth middleware blocks Vercel Cron monitors (CRITICAL)
- `src/middleware.ts` matcher does NOT whitelist `/api/monitor/*`
- Vercel Cron runs without session cookies → all monitor requests redirect to /login
- **Impact**: QA Monitor + External Monitor from upgrade #57 will NEVER run on the schedule
- **Fix**: Add `monitor` to the matcher exception regex

### C2 — Auth middleware blocks subagents API (CRITICAL)
- `/api/subagents` returns 307 redirect
- **Impact**: Super agent / external tooling cannot query the subagent list
- **Fix**: Add `subagents` to matcher exception

### C3 — Auth middleware blocks backup JSON download (CRITICAL — owner complaint)
- `/api/backup` returns 307 redirect
- **Impact**: Owner cannot download JSON backup without being logged in
- This is the root cause of "I can't download it"
- **Fix**: Add `backup` to matcher exception (the endpoint already has its own auth for sensitive ops)

### C4 — Production DB URL broken (CRITICAL)
- `/api/system/backup-download` returns 500 with Prisma error: "URL must start with `file:`"
- Production's `DATABASE_URL` env var is either missing or pointing to non-SQLite
- **Impact**: Backup generation, seed-agents, audit endpoint all fail
- **Fix**: In code, set `process.env.DATABASE_URL` to a default SQLite file path BEFORE Prisma initializes, if the env var is missing/invalid

### C5 — Upgrade #57 NOT deployed (CRITICAL)
- Production totalUpgrades=53, latest=real_integrations_v3_56
- QA Monitor + External Monitor code from yesterday's session was committed but never deployed
- **Impact**: All the monitor work is invisible to production
- **Fix**: Deploy the latest commit (8844cef + new fixes)

### C6 — `/api/system/audit` 404 in production (HIGH)
- Source file `src/app/api/system/audit/route.ts` exists with `export async function GET()`
- Production returns 404 — means production build is severely outdated
- **Fix**: Deploy

## Other Issues Found

### O1 — `/api/health` referenced but doesn't exist (MEDIUM)
- External Monitor probes `https://agent007-ai.vercel.app/api/health`
- Endpoint returns 404 — monitor will report false-positive failure
- **Fix**: Create `/api/health` route returning `{ok:true, timestamp, version}`

### O2 — Vercel /tmp backup persistence (MEDIUM)
- `/api/system/zip-backup` creates files in `/tmp/agent007-backups`
- Vercel /tmp is EPHEMERAL — files don't survive cold starts
- The `/api/system/backup-download` endpoint solves this by regenerating on-demand, but it 500s due to C4
- **Fix**: Fix C4 + the on-demand endpoint becomes the canonical download path

### O3 — Production build outdated (HIGH)
- Multiple endpoints (audit, monitor/*) exist in code but return 404 in production
- Production is running an older build (pre-upgrade-#54)
- **Fix**: Deploy the latest commit

## Source code review (super agent access)

### Super agent tool access — VERIFIED ✅
- `src/lib/agent.ts` line 762: `dispatchTool(step.toolName!, step.toolArgs, ctx)` — no restriction
- `src/lib/orchestrator.ts` line 984: same — no restriction
- No `allowedTools` check, no `restrictedTools` list, no `toolBlocked` filter
- The super agent (Agent007) can call ANY tool in `TOOL_REGISTRY` (currently 567 tools)

### Subagent tool access — VERIFIED ✅
- `src/lib/subagents.ts` line 1178: `const allowed = new Set([...FULL_ACCESS_TOOLS])` — every subagent gets FULL_ACCESS_TOOLS at dispatch time, regardless of its `allowedTools` config
- `FULL_ACCESS_TOOLS` (line 189) is a Proxy that returns ALL keys from `TOOL_REGISTRY`
- Comment at line 1171-1177: "Always grant FULL_ACCESS_TOOLS to every subagent"

### Permanently locked agents — VERIFIED ✅
- `NEVER_DISABLE_IDS = {'testfast2', 'fasttest3'}` in `src/app/api/subagents/[id]/route.ts`
- DELETE → 403 with `permanent:true`
- PUT on locked fields (systemPrompt, allowedTools, enabled) → 403 with `permanent:true`
- Owner CAN still edit cosmetic fields (color, role, specialty)

## Dashboard / Login / Nav structure (source code review)

### Dashboard tabs (5 nav items) — `src/components/agent/chat-header.tsx:34-40`
1. Chat (`MessageSquare` icon)
2. Missions (`Rocket` icon)
3. Dashboard (`LayoutDashboard` icon)
4. Schedules (`CalendarClock` icon)
5. Settings (`SettingsIcon` icon)
- All tabs render in a horizontally-scrollable `<nav role="tablist">` element
- Mobile: scroll-cyan style, touchAction: manipulation
- Active state: cyan-200 text + cyan-400/10 bg + cyan-400/40 border
- Inactive: gray text, transparent border, hover cyan

### Login page — `src/app/login/page.tsx`
- Pre-flight 2FA challenge via `/api/2fa/challenge`
- 6-digit code input with resend + cancel
- Supports email/WhatsApp/SMS/Google Auth
- Callback URL preserved through redirect

### Subagents (18 total)
- 12 original built-ins: aurora, vertex, prism, forge, scout, hunter, pulse, banker, legal, cybersecurity_a, cybersecurity_r, developer
- 6 promoted built-ins: trader, cybersecurity_a, cybersecurity_r, developer, testfast2 (QA Monitor), fasttest3 (External Monitor)
- All have FULL_ACCESS_TOOLS at dispatch (line 1178)

## Fix Plan (in order)

1. Fix `src/middleware.ts` — add `monitor`, `subagents`, `backup`, `health` to matcher exceptions
2. Create `src/app/api/health/route.ts` — public health endpoint
3. Fix `src/lib/db.ts` — set default `DATABASE_URL` if missing/invalid (before Prisma init)
4. Fix `src/lib/backup-functions.ts` — make backup work even if some DB queries fail (graceful degradation)
5. Verify upgrade #57 + monitors are in code (already done)
6. Commit fixes
7. Deploy to Vercel
8. Verify all endpoints return expected status codes
9. Dispatch super agent to redo audit + fix issues autonomously
10. Generate full backup JSON + ZIP (with proper download URLs)
