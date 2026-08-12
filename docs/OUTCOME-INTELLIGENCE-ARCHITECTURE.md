# Agent007 Outcome Intelligence

## Purpose

Outcome Intelligence separates **transport success** from **verified task success**. A provider returning HTTP 200 is not evidence that the work was useful, correct, or valuable.

## Evidence hierarchy

1. Provider/API success — weakest signal.
2. Task completion — stronger signal.
3. Independent verification — stronger still.
4. Verified quality — stronger still.
5. Verified business value — strongest routing evidence.

## Runtime boundary

- Governance decides what is permitted.
- Provider Intelligence decides the provider chain: **Groq → OpenAI → Z.ai → Mistral**.
- Model Intelligence selects the model inside the provider.
- Performance Intelligence measures transport/runtime behavior.
- Outcome Intelligence records verified outcomes and produces recommendations.

Outcome Intelligence **does not change provider priority** and does not authorize actions.

## Safety

Outcome scores are clamped to 0–100, observations are bounded, and confidence remains below certainty. Financial and security tasks continue to require their stricter verification policy.

Automatic routing optimization should only consume Outcome Intelligence after sufficient evidence exists; this phase deliberately provides recommendations without allowing unbounded self-modification of governance.
