# Agent007 CEO Cognitive Lifecycle

## Purpose

This document is the canonical architecture contract for CEO-facing reasoning. It extends the existing provider governance and executive evidence gates without replacing them.

## Runtime lifecycle

```text
User / CEO
  -> Cheap Pre-Router
     FAST -> Canonical Runtime -> lightweight validation -> Response Composer -> CEO
     FULL/AMBIGUOUS -> Decision Kernel -> Execution Plan -> Adaptive/Canonical Runtime
                        -> Quality Gate -> Response Composer -> CEO

Total external execution failure
  -> Degraded-Mode Responder -> Response Composer -> CEO

Quality failure
  -> bounded escalation -> Decision/Execution Plan again
```

`AMBIGUOUS` is always resolved to `FULL`. This is deliberate: uncertainty costs latency, but under-processing a complex request is a larger correctness risk.

## Decision Kernel

`src/lib/ceo-cognitive-kernel.ts` is the request-level planning kernel. It produces a `DecisionPlan` containing task class, mission relevance, quality tier, reasoning strategy, cognitive depth, verification requirements, latency budget, provider-attempt budget, and maximum escalation depth.

`src/lib/ceo-decision-kernel.ts` is a separate deterministic mission approval gate. It does not route providers; it authorizes or blocks mission completion based on evidence, artifacts, verification, and protected-action governance.

## Execution plan

`src/lib/ceo-execution-plan.ts` materializes every declared reasoning strategy:

- `direct` -> primary stage
- `multi_pass` -> primary + refinement stage
- `independent_review` -> primary + independent review + synthesis

Independent review excludes the primary provider. Critical synthesis may reuse the primary provider after independent review when necessary, preserving review independence without requiring three simultaneously available providers.

Every plan has a hard escalation ceiling.

## Provider/runtime integration

The lifecycle uses the existing canonical provider runtime. It does not create a second provider registry or provider-selection system. Live model governance, provider health, error taxonomy, performance intelligence, and outcome intelligence remain authoritative in the existing control plane.

The canonical runtime now accepts an explicit provider exclusion set so independent review can be genuinely independent.

## Quality

Fast-path responses use deterministic lightweight validation. Full and critical paths use the Quality Gate. A provider returning HTTP 200 is not treated as proof that the response is good; quality is evaluated separately.

Evidence states are qualitative and explicit:

- `LIVE_VERIFIED`
- `VERIFIED_CACHED`
- `MEMORY_ONLY`
- `PARTIAL_UNCONFIRMED`
- `UNAVAILABLE`

No fabricated numeric confidence is introduced by this lifecycle.

## Degraded mode

`src/lib/ceo-degraded-mode.ts` is a resilience floor, not a replacement for live reasoning. It can safely surface supplied verified context when external providers are unavailable and otherwise reports an honest unavailable state. All degraded responses use the same Response Composer as normal responses.

## Integration boundaries

CEO entry points must enter `runCeoCognitiveLifecycle`. The compatibility bridge preserves existing caller response shapes while carrying lifecycle metadata. The mission executive presenter uses the same lifecycle before composing the final report.

The lifecycle audit and CI workflow are required to prevent missing modules, duplicate lifecycle modules, direct CEO-to-provider bypasses, unbounded escalation, and provider-independence regressions.
