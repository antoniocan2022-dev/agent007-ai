# Agent007 AI — Architecture Ownership Map

> **UPGRADE #212** — Documents which module owns each responsibility.
> This prevents overlapping responsibilities as the system grows.

## Core Architecture Pattern

```
User
  │
  ▼
Executive Layer (CEO Presenter + Orchestrator)
  │
  ▼
Mission Pipeline (Mission OS)
  │
  ▼
Leader Council (20 pod leaders across 8 pods)
  │
  ▼
Verification (Super-Agent Verifier + ECHO Quality Gate)
  │
  ▼
Response
```

## Responsibility Ownership

| Responsibility | Owner Module | Backup / Fallback |
|---|---|---|
| **Planning** | `mission-os.ts` (Mission OS Pipeline) | `mission-pipeline.ts` (legacy) |
| **Orchestration** | `orchestrator.ts` | — |
| **Executive Decisions** | `ceo-presenter.ts` (CEO Layer) | `super-agent-verifier.ts` |
| **Leader Debate** | `leader-debate.ts` | — |
| **Verification** | `super-agent-verifier.ts` | `accuracy_checker` + `quality_scorer_v2` |
| **Quality Gate** | ECHO subagent + `quality_scorer_v2` | `result_verifier_v2` |
| **Memory** | `persistent-memory.ts` | `memory.ts` (basic) |
| **Memory Orchestration** | `memory_store` / `memory_recall` tools | `failure_learning` tool |
| **Tool Dispatch** | `tools.ts` (TOOL_REGISTRY) | — |
| **Subagent Dispatch** | `subagents.ts` (SUBAGENTS array) | — |
| **Autonomous Planning** | `autonomous-strategic-planner.ts` | Vercel Cron (9AM UTC) |
| **Strategic Question Detection** | `orchestrator.ts` (STRATEGIC_KEYWORDS) | — |
| **System Status Reports** | `orchestrator.ts` (auto-diagnostics) | — |
| **Knowledge Base** | `knowledge-base.ts` + `charter-injector.ts` | `kb_search` tool |
| **Scheduling** | Vercel Cron (`vercel.json`) | — |
| **Response Synthesis** | Executive Brain (in orchestrator) | — |

## Overlap Prevention Rules

1. **Only ONE module owns planning** → `mission-os.ts`
2. **Only ONE module owns verification** → `super-agent-verifier.ts`
3. **Only ONE module owns synthesis** → Executive Brain (in `orchestrator.ts`)
4. **Only ONE module owns memory** → `persistent-memory.ts`
5. **Only ONE module owns scheduling** → Vercel Cron (`vercel.json`)

## Morning Brief Endpoints (Two Entry Points, One Logic)

| Endpoint | Trigger | Auth | Returns |
|---|---|---|---|
| `/api/schedules/morning-brief` | Vercel Cron (0 9 * * *) | None | Minimal status JSON |
| `/api/system/morning-brief` | Manual browser visit | Session | Full brief + sections |

Both call `runMorningBrief()` from `autonomous-strategic-planner.ts`.

---

*Last updated: upgrade-212*
