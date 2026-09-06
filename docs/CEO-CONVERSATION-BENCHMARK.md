# CEO Conversation Benchmark

## Purpose

This benchmark is the executable contract for Agent007's conversational intelligence. It exists to prevent architectural claims from exceeding tested behavior.

## v0.1 contract

The benchmark contains 25 hand-checked semantic scenarios plus 10 golden multi-turn conversations. It covers pronouns and demonstratives, ordered references, temporal references, active-thread continuation, ambiguity, missing antecedents, topic shifts, corrections, long-context continuity, and casual conversation.

## Required behavior

1. A resolvable reference must identify a concrete antecedent and provide confidence.
2. An ambiguous reference must remain unresolved rather than being fabricated.
3. Ordinals must resolve against an actual enumerated list item.
4. Temporal references must use calendar boundaries from message timestamps and an explicit time zone.
5. `continue` must resolve against a structured active or paused conversation thread.
6. Conversation quality must not expose evidence or governance metadata during ordinary dialogue.
7. The same semantic contracts must run in CI on every relevant `main` change.

## v0.2 adversarial extension

The canonical conversation semantic suite also contains transcript-derived adversarial cases for:

- Phoenix recall.
- Historical rationale with correct uncertainty when provenance is absent.
- Commercial pivots and explicit corrections.
- Multiple lists and ordinal references without stale-list inheritance.
- Temporal references with calendar-window resolution.
- Topic switching and current-topic identification.
- Provider failure classification as infrastructure state, separate from conversational state.
- Degraded recovery without fabricated verification or internal execution traces.
- Fluent-but-wrong answers that must be rejected by the continuity gate.
- Correct current-topic answers that must pass.

The adversarial contract explicitly tests four outcome classes: correct answer, correct uncertainty, correct degradation, and incorrect-answer rejection.

## Expansion roadmap

- v0.1: 25 semantic cases + 10 golden conversations.
- v0.2: transcript-derived adversarial cases integrated into the canonical semantic suite.
- v0.3: 100+ long-form conversations and provider-fallback checks.
- v1.0: 120–200 production-like conversations, including sampled live-model evaluation.

## Evidence standard

A feature is not considered implemented merely because a function or interface exists. The feature is considered implemented when its behavior is exercised by a deterministic test contract and the contract passes in CI.
