# CEO Conversational Intelligence

## Purpose

Agent007 is an executive operating system, but ordinary dialogue must remain natural. Conversation is a first-class cognitive workload; evidence, tools, verification, and execution are activated only when the request actually requires them.

## P0 invariants

### Deployment reality
A feature is not considered production-verified until the exact GitHub `main` SHA equals the Vercel production SHA. The `/api/agent` SSE envelope includes the deployment ID and release commit so live verification can be performed against the source of truth.

### Conversation state
The existing durable `Conversation` + `Message` history is the source of truth. `deriveCeoConversationState()` builds a deterministic, bounded state model from that durable history instead of introducing a second persistent database authority. This state contains topic, entities, active threads, open questions, decisions, recent goals, tone, and turn count.

### Semantic reference resolution
`resolveConversationReferences()` resolves conversational references such as `it`, `that`, `the second one`, `earlier`, `yesterday`, and `continue` against recent history plus the derived state. Resolution is contextual and confidence-scored; unresolved references are not fabricated.

### Conversation-first routing
The CEO conversation lane has no evidence requirement, no tool requirement, and no mandatory multi-pass verification. Self-assessment, research, analysis, tool actions, mission actions, and production actions retain their governed execution contracts.

### Natural response boundary
Evidence state, quality state, routing metadata, provider identity, and execution telemetry are internal data. Ordinary conversation does not expose these labels in the user-facing answer.

## P1 capabilities

### Long-context intelligence
The canonical Context Composer retains more recent turns, retrieves relevant older turns, summarizes displaced history, selects relevant semantic memories, and injects the derived conversation state. It has a fixed total context budget to prevent runaway prompts.

### Ten-dimensional conversation quality
Conversational answers are evaluated on continuity, relevance, naturalness, tone alignment, coherence, non-repetition, initiative, reference resolution, personality consistency, and progression. Conversation quality is independent of evidence verification.

### Conversation repair
Weak conversational results enter the existing bounded escalation loop. Repair is driven by the measured quality findings rather than by forcing the whole request through research or operational execution.

### CEO model routing
Provider priority for reasoning/general CEO work is quality-first while every configured provider remains a governed fallback. Operations retain a documented speed-first preference for future task-specific routing.

## P2 capabilities

### Persistent personality contract
The canonical context includes one stable communication contract: natural, thoughtful, direct, context-aware, adaptive in depth, honest about uncertainty, and free of internal governance language during normal conversation.

### Conversation benchmark
The repository contains 120 parameterized multi-turn scenarios exercising long-context continuity, topic persistence, reference resolution, follow-ups, and the transition between conversational and execution workloads.

## Design principle

```text
Conversation understanding
        ↓
Conversation state + semantic references
        ↓
Conversation-first decision
        ↓
Natural CEO response
        │
        └── only when needed → evidence / tools / agents / verification
                                   ↓
                              Natural response
```

The objective is not to make Agent007 perform more internal ceremony. The objective is to make the intelligence available to the user feel coherent, capable, and continuous while preserving all existing governance guarantees underneath.
