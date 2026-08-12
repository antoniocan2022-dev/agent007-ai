# Model Routing Verification — 2026-08-12

Agent007 now separates provider governance from model intelligence.

- Provider order: Groq → OpenAI → Z.ai → Mistral.
- Model choice: task-aware inside each provider.
- Explicit model override: authoritative.
- Provider health/circuit state: authoritative for availability.
- Financial/security: stricter verification retained.

This document exists as a lightweight audit marker for the routing boundary and its acceptance criteria.