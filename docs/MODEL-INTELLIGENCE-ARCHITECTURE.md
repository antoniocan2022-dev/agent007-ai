# Agent007 Model Intelligence Contract

## Purpose

Provider Intelligence owns **provider availability, health, circuit breaking, and deterministic provider order**. Model Intelligence owns **task fit inside a provider**.

These responsibilities must not be merged.

## Runtime contract

1. Determine the governed task type and verification tier.
2. Build the configured provider chain in policy order: **Groq → OpenAI → Z.ai → Mistral**.
3. Remove only providers that are unavailable or circuit-open.
4. For each remaining provider, select its task-aware model from the canonical model matrix.
5. Never let model fit reorder the provider chain.
6. An explicitly requested model always wins over automatic model selection.
7. Record provider health using the existing Provider Intelligence telemetry.
8. Financial and security tasks retain stricter verification requirements.

## Why this boundary matters

A model-quality score must not silently override governance. A highly ranked model at a lower-priority provider cannot jump ahead of a healthy higher-priority provider. This keeps routing deterministic, auditable, and compatible with the existing Governance 2.0 policy.

The model matrix uses normalized engineering priors for capability fit, quality, speed, and cost tier. These values are routing heuristics, not benchmark claims.
