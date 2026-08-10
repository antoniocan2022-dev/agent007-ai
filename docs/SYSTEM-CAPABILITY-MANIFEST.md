# Agent007 System Capability Manifest

**Manifest version:** 1.0  
**Purpose:** canonical architecture contract for autonomy measurement and integration

> This document is the semantic contract. Executable registries remain authoritative for exact runtime names. Any mismatch between this document and executable code is an inventory-drift finding that must be corrected, not silently ignored.

## Executive system

- CEO / Executive layer: strategic intent, priorities, policy and final authority boundaries.
- Mission layer: persistent objectives, state, next actions, success criteria and terminal outcomes.
- Orchestration layer: planning, tool dispatch, sub-agent dispatch, management actions and recovery coordination.
- Verification layer: evidence-based outcome validation and reality checks.
- Memory layer: persistent context and learned operational knowledge.
- Governance layer: authorization, risk, audit, protected actions and human escalation.

## Capability domains

1. Executive intelligence
2. Mission management
3. Orchestration and execution
4. Sub-agent coordination
5. Research and world observation
6. Memory and knowledge
7. Business strategy
8. Revenue generation
9. Sales and outreach
10. Marketing and content
11. Customer success
12. Finance and reconciliation
13. Risk and compliance
14. Communication
15. Monitoring and observability
16. Self-repair and recovery
17. Security and identity
18. Developer / code operations
19. Data and storage
20. Scheduling and recurring operations

## Autonomy-critical capabilities

### Mission
A mission must be representable with:
- objective
- owner
- priority
- current state
- next action
- success criteria
- verification method
- risk/authority level
- dependencies
- terminal outcome

### Decision
A decision must record:
- candidate action
- expected value
- confidence
- risk
- cost
- reversibility
- policy result
- chosen action
- reason

### Execution
Execution must produce:
- action identity
- input/context
- result/evidence
- duration
- errors
- retry/recovery state

### Verification
Verification must distinguish:
- requested action
- observed effect
- evidence source
- verification status
- confidence
- unresolved uncertainty

### Recovery
Recovery must distinguish:
- incident
- severity
- root cause
- attempted remedy
- verification result
- rollback or alternate strategy
- recurrence prevention

### Learning
Learning must record:
- observation
- expected outcome
- actual outcome
- delta
- lesson
- confidence
- policy/strategy candidate
- whether the learning was accepted

## Authority classes

- `AUTONOMOUS_SAFE`: routine, reversible, policy-approved.
- `AUTONOMOUS_BOUNDED`: autonomous within explicit budget/risk limits.
- `HUMAN_APPROVAL`: Agent007 may prepare and recommend, but owner approval is required.
- `HUMAN_EXECUTION`: external/legal/physical action must be performed by a human.
- `FORBIDDEN`: action is never available through autonomous execution.

## Financial truth boundary

The manifest explicitly separates:

- opportunity
- projection
- lead
- customer intent
- checkout initiation
- processor confirmation
- verified transaction
- reconciled revenue

Only processor-confirmed/reconciled transactions may be treated as verified revenue.

## Documentation integrity

Known historical documentation drift must be resolved through the canonical executable inventory. For example, the README has previously described 18 sub-agents while the current subagent registry describes 20 specialists (12 built-in + 8 custom). This is exactly the kind of discrepancy the manifest exists to expose and eliminate.

## Deployment boundary

Development and verification for the Autonomy 95 program occur in GitHub. Production deployment to Vercel is a separate controlled action and requires explicit owner authorization.
