# Agent007 Performance Intelligence Contract

## Role

Performance Intelligence learns from runtime evidence: success/failure, latency, task type, provider, and model. It produces advisory model recommendations and confidence values.

## Hard boundary

Performance Intelligence **must never** change the authoritative provider priority:

**Groq → OpenAI → Z.ai → Mistral**

Provider Intelligence remains responsible for provider availability, health, circuit breaking, and failover. Model Intelligence remains responsible for canonical task/model fit. Performance Intelligence can improve model choice only inside an already-authorized provider boundary.

## Learning policy

- Cold start uses canonical model priors.
- Runtime observations are bounded to prevent unbounded memory growth.
- Confidence increases with evidence and is capped below certainty.
- Success rate and latency are combined with the existing model priors.
- No dollar-cost claims are inferred without token/price telemetry.
- Runtime failure remains authoritative over learned recommendations.

## Next evolution

The next layer can add durable mission-level outcomes and verified quality scores. Those signals should be incorporated only after they are independently measured, not inferred from latency or provider success alone.
