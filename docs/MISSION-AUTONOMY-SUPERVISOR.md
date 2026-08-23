# Mission Autonomy Supervisor

## Purpose

The Mission Autonomy Supervisor is the durable control loop for active missions. It does not replace the CEO, mission governance, provider runtime, or specialist agents. It coordinates them around persistent mission state.

## Lifecycle

```text
Persistent Mission
  ↓
Supervisor heartbeat
  ↓
Capability readiness
  ↓
Current-stage inspection
  ├─ OWNER_APPROVAL → wait for owner
  ├─ verified artifact → advance
  ├─ missing capability → safe same-class replan or escalation
  ├─ unverified artifact → wait/block
  └─ active/stale stage → run current leader
  ↓
Leader execution
  ↓
Artifact / evidence
  ↓
Verification
  ↓
Next heartbeat
```

## Safety boundaries

- Owner approval is never auto-approved.
- A stage cannot advance when its required artifact is missing or unverified.
- Replanning is limited to a same-class, capability-compatible, enabled specialist and is not performed for critical-risk leaders or owner approval.
- Leader execution is bounded per heartbeat to prevent runaway provider/tool usage.
- Every heartbeat records durable supervisor state including the last action, blocker, failure count, and next action.
- CEO requests use the CEO Cognitive Lifecycle; specialist work uses the existing subagent runtime.

## Capability readiness

Mission stages have explicit task and tool requirements. A specialist is considered ready only when its governance profile exists, the specialist is enabled, its governance task type matches the stage, and its required tools are present in its allowed tool set.

## Persistence and overnight execution

The supervisor state is stored in the existing durable `UserSetting` store. The supervisor is invoked from the existing protected scheduler endpoint, so mission state and supervisor state survive function restarts. The scheduler cadence remains a hosting/plan constraint; on Vercel Hobby the current scheduler is daily, so this provides scheduled autonomy rather than a continuously running worker.

## Completion rule

The supervisor does not call a mission complete merely because a model says it is complete. Completion remains dependent on the mission state machine, required artifacts, verification, and the explicit owner-approval boundary.
