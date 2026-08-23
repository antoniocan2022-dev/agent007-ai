# Agent007 CEO Cognitive Lifecycle

## Purpose

This document is the canonical architecture contract for CEO-facing reasoning. It extends the existing provider governance and executive evidence gates without replacing them.

## Runtime lifecycle

```text
User / CEO
  -> Cheap Pre-Router
     FAST -> Canonical Runtime -> lightweight validation -> Response Composer -> CEO
     FULL/AMBIGUOUS -> Decision Kernel -> Execution Plan -> Adaptive/Canonical Runtime
                        -> Response Quality Gate -> Response Composer -> CEO

Total external execution failure
  -> Degraded-Mode Responder -> Response Composer -> CEO

Quality failure
  -> bounded escalation -> Decision/Execution Plan again
```

`AMBIGUOUS` is always resolved to `FULL`, and the DecisionPlan treats that result as a minimum cognitive floor: an ambiguous/full pre-route can never produce a `fast` path or `direct` reasoning strategy. Uncertainty costs latency, but under-processing a complex request is a larger correctness risk.

## Decision architecture

`src/lib/ceo-cognitive-kernel.ts` is the **request-level Reasoning Planner**. It consumes canonical pre-route/task-classification facts and produces a `DecisionPlan` containing task class, mission relevance, quality tier, reasoning strategy, cognitive depth, verification requirements, latency budget, provider-attempt budget, and maximum escalation depth.

`src/lib/ceo-decision-kernel.ts` is the **Mission Governance Gate** (legacy export name retained for compatibility). It is authoritative only for mission evidence, artifact, verification, and protected-action governance. `PROCEED` is required before normal mission executive LLM synthesis is allowed; `HOLD` and `REJECT` use a deterministic blocked report instead.

The pre-router and canonical adaptive execution classifier are one classification authority: the pre-router records the canonical task class and adaptive execution class so the Reasoning Planner does not independently reinterpret the request, while the planner enforces the pre-router's minimum path floor.

## Execution plan

`src/lib/ceo-execution-plan.ts` materializes every declared reasoning strategy:

- `direct` -> primary stage
- `multi_pass` -> primary + refinement stage
- `independent_review` -> primary + independent review + synthesis

Independent review excludes the primary provider. Critical synthesis may reuse the primary provider after independent review when necessary, preserving review independence without requiring three simultaneously available providers.

Every plan has a hard escalation ceiling and the lifecycle also enforces the request deadline.

## Provider/runtime integration

The lifecycle uses the existing canonical provider runtime. It does not create a second provider registry or provider-selection system. Live model governance, provider health, error taxonomy, performance intelligence, and outcome intelligence remain authoritative in the existing control plane.

The canonical runtime accepts an explicit provider exclusion set so independent review can be genuinely independent.

CEO application entry points must use `runCeoCognitiveLifecycle`. The legacy `agent.ts` LLM implementation is retained only as a compatibility surface; application/library callers outside approved boundaries are forbidden by the lifecycle audit.

System health probing is an explicit exception: `src/app/api/system/diagnose-llm/route.ts` may call the canonical provider runtime directly because it is a read-only health probe, not CEO response generation.

## Quality and evidence

Fast-path responses use deterministic lightweight validation. Full and critical paths use the **Response Quality Gate**. A provider returning HTTP 200 is never treated as proof that the response is verified.

Execution and verification are separate concepts. Evidence states are qualitative and explicit:

- `LIVE_EXECUTED` — a governed live provider produced the response, but supporting evidence was not supplied and independent evidence verification was not established.
- `LIVE_VERIFIED` — a governed live response passed the critical independent-review path **and** supporting evidence was supplied to the quality contract.
- `VERIFIED_CACHED` — reserved for a future explicitly verified cache path; it is not emitted merely because an item is cached.
- `MEMORY_ONLY` — the response is based on supplied or automatically recovered persistent mission/system memory without fresh external reasoning.
- `PARTIAL_UNCONFIRMED` — useful output exists, but verification is incomplete.
- `UNAVAILABLE` — the system does not have enough available evidence to responsibly answer.

No fabricated numeric confidence is introduced by this lifecycle.

## Degraded mode

`src/lib/ceo-degraded-mode.ts` is a **Degraded-Mode Responder**, not a substitute for live reasoning. When providers are unavailable, it first uses explicitly supplied context when present; otherwise it automatically queries the canonical `persistent-memory` layer using the mission/request objective. If relevant internal evidence is recovered, the result is labeled `MEMORY_ONLY`; if nothing relevant is recovered, it honestly returns `UNAVAILABLE`. All degraded responses use the same Response Composer as normal responses.

## Integration boundaries

The canonical CEO response bridge enters `runCeoCognitiveLifecycle`. The mission-active CEO API route also enters the lifecycle directly; it must not call the legacy `agent.ts` LLM path. The mission executive presenter uses the Mission Governance Gate as a hard generation boundary before normal lifecycle synthesis.

The lifecycle audit and CI workflow inspect `src/lib`, `src/app`, and `tests` to prevent missing modules, duplicate lifecycle modules, direct provider/runtime bypasses, legacy-agent callers, unbounded escalation, provider-independence regressions, and behavioral regressions in the pre-router, quality gate, and degraded-mode evidence recovery.
