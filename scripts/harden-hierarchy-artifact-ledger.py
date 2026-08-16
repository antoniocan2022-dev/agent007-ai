from pathlib import Path

ROOT = Path('.')


def replace_once(path: str, old: str, new: str, *, required: bool = True) -> None:
    p = ROOT / path
    text = p.read_text()
    count = text.count(old)
    if count == 0 and new in text:
        return  # already hardened; idempotent success
    if required and count != 1:
        raise SystemExit(f'{path}: expected exactly one match for patch, got {count}: {old[:100]!r}')
    if count:
        p.write_text(text.replace(old, new, 1))

# 1) Enforce explicit parent context for every agent-to-agent run.
replace_once('src/lib/subagents.ts',
    '  const parentAgentId = opts.parentAgentId ?? \'ceo\'\n  try {\n    assertDelegationAllowed(parentAgentId, sub.id, true, opts.delegationAuthority ?? \'agent\')',
    "  const delegationAuthority = opts.delegationAuthority ?? 'agent'\n  if (!opts.parentAgentId && delegationAuthority === 'agent') {\n    const err = `Delegation blocked: subagent ${sub.id} requires an explicit parentAgentId.`\n    await opts.emit('subagent_complete', { dispatchId: opts.dispatchId, answer: `⚠️ ${err}` })\n    return { answer: `⚠️ ${err}`, steps: [] }\n  }\n  const parentAgentId = opts.parentAgentId ?? (delegationAuthority === 'owner' ? 'owner' : 'system')\n  try {\n    assertDelegationAllowed(parentAgentId, sub.id, true, delegationAuthority)")
replace_once('src/lib/subagents.ts',
    "  const ctx: ToolContext = { attachments: opts.attachments, language: opts.language }",
    "  const ctx: ToolContext = { attachments: opts.attachments, language: opts.language, parentAgentId: sub.id }")

# 2) Orchestrator is the CEO control plane; all tools it executes inherit CEO authority.
replace_once('src/lib/orchestrator.ts',
    "  const ctx: ToolContext = { attachments, language }",
    "  const ctx: ToolContext = { attachments, language, parentAgentId: 'ceo' }")

# 3) Parallel subagent dispatcher must use the real caller authority; never default to VID.
replace_once('src/lib/autonomy-tools.ts',
    "  if (valid.length === 0) return fail('No valid subagents to dispatch.')\n  const startTime = Date.now()",
    "  if (valid.length === 0) return fail('No valid subagents to dispatch.')\n  if (!ctx?.parentAgentId) return fail('Parallel dispatch blocked: missing governed parentAgentId.')\n  const startTime = Date.now()")
replace_once('src/lib/autonomy-tools.ts',
    "parentAgentId: ctx?.parentAgentId ?? 'vid',",
    "parentAgentId: ctx.parentAgentId,")

# 4) Artifact schema: preserve handoff history as a first-class ledger field.
replace_once('prisma/schema.prisma',
    '  metadata          String?\n  createdAt         DateTime  @default(now())',
    '  metadata          String?\n  handoffHistory    String?\n  createdAt         DateTime  @default(now())')

# 5) Runtime DDL: add the field for new and already-existing Postgres tables.
replace_once('src/lib/db.ts',
    '`CREATE TABLE IF NOT EXISTS "ArtifactLedger" (id TEXT PRIMARY KEY, "artifactId" TEXT UNIQUE NOT NULL, "missionId" TEXT, "ventureId" TEXT, "parentArtifactId" TEXT, "stageId" TEXT, "artifactType" TEXT NOT NULL, name TEXT NOT NULL, version INTEGER DEFAULT 1, status TEXT DEFAULT \'submitted\', "producerAgentId" TEXT NOT NULL, "consumerAgentId" TEXT, "sourceRef" TEXT, "artifactValue" TEXT, "contentHash" TEXT NOT NULL, "verificationScore" DOUBLE PRECISION, "verifiedBy" TEXT, "verifiedAt" TIMESTAMP(3), metadata TEXT, "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP)`,',
    '`CREATE TABLE IF NOT EXISTS "ArtifactLedger" (id TEXT PRIMARY KEY, "artifactId" TEXT UNIQUE NOT NULL, "missionId" TEXT, "ventureId" TEXT, "parentArtifactId" TEXT, "stageId" TEXT, "artifactType" TEXT NOT NULL, name TEXT NOT NULL, version INTEGER DEFAULT 1, status TEXT DEFAULT \'submitted\', "producerAgentId" TEXT NOT NULL, "consumerAgentId" TEXT, "sourceRef" TEXT, "artifactValue" TEXT, "contentHash" TEXT NOT NULL, "verificationScore" DOUBLE PRECISION, "verifiedBy" TEXT, "verifiedAt" TIMESTAMP(3), metadata TEXT, "handoffHistory" TEXT, "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP)`,')
replace_once('src/lib/db.ts',
    '`CREATE INDEX IF NOT EXISTS "ArtifactLedger_status_idx" ON "ArtifactLedger" (status)`,',
    '`CREATE INDEX IF NOT EXISTS "ArtifactLedger_status_idx" ON "ArtifactLedger" (status)`,\n      `ALTER TABLE "ArtifactLedger" ADD COLUMN IF NOT EXISTS "handoffHistory" TEXT`,')

# 6) Mission pipeline: make the CEO artifact part of the lineage and never mark an empty deliverable verified.
replace_once('src/lib/mission-pipeline.ts',
    "          missionId, stageId: `stage_${stage.stage}`, artifactType: 'executive_report',\n          name: stage.name, producerAgentId: 'ceo', sourceRef: `mission:${missionId}:stage:${stage.stage}`",
    "          missionId, stageId: `stage_${stage.stage}`, artifactType: 'executive_report',\n          parentArtifactId: opts.previousArtifactId,\n          name: stage.name, producerAgentId: 'ceo', sourceRef: `mission:${missionId}:stage:${stage.stage}`")
replace_once('src/lib/mission-pipeline.ts',
    "  const artifactVerified = artifactValue !== null && lastVerification?.approved === true\n  let artifactId: string | undefined",
    "  const artifactVerified = stage.artifactType === 'none' || (artifactValue !== null && lastVerification?.approved === true)\n  let artifactId: string | undefined")
replace_once('src/lib/mission-pipeline.ts',
    "      artifactValue, content: teamOutput, status: lastVerification?.approved ? 'verified' : 'rejected',",
    "      artifactValue, content: teamOutput, status: artifactVerified ? 'verified' : 'rejected',")
replace_once('src/lib/mission-pipeline.ts',
    "      verificationScore: lastVerification?.score ?? 0, verifiedBy: 'super_agent',\n      verifiedAt: lastVerification ? new Date() : undefined, metadata: { round: lastRound },",
    "      verificationScore: artifactVerified ? (lastVerification?.score ?? 0) : 0, verifiedBy: artifactVerified ? 'super_agent' : undefined,\n      verifiedAt: artifactVerified && lastVerification ? new Date() : undefined, metadata: { round: lastRound },")

# Resume safety: reconstruct the latest approved artifact so resumed stages preserve lineage.
replace_once('src/lib/mission-pipeline.ts',
    "  let previouslyCompletedStages: Set<string> = new Set()\n  try {\n    const { loadApprovalLog } = await import('./approval-audit-log')",
    "  let previouslyCompletedStages: Set<string> = new Set()\n  try {\n    const priorArtifacts = await import('./artifact-ledger').then(({ listMissionArtifacts }) => listMissionArtifacts(missionId))\n    const latestVerifiedArtifact = [...priorArtifacts].reverse().find((artifact) => artifact.status === 'verified' || artifact.status === 'handed_off')\n    if (latestVerifiedArtifact) {\n      previousArtifactId = latestVerifiedArtifact.artifactId\n      previousTeamOutput = latestVerifiedArtifact.artifactValue ?? undefined\n    }\n  } catch {}\n  try {\n    const { loadApprovalLog } = await import('./approval-audit-log')")

# Ensure every stage handoff is recorded before the next stage starts and failures never hide it.
replace_once('src/lib/mission-pipeline.ts',
    "      if (result.artifactId && stage.stage < pipeline.stages.length && result.artifactVerified) {\n        const nextStage = pipeline.stages[stage.stage]\n        if (nextStage) await handoffArtifact(result.artifactId, nextStage.leader).catch(() => {})\n      }",
    "      if (result.artifactId && stage.stage < pipeline.stages.length && result.artifactVerified) {\n        const nextStage = pipeline.stages[stage.stage]\n        if (nextStage) {\n          try {\n            await handoffArtifact(result.artifactId, nextStage.leader)\n          } catch (handoffError: any) {\n            await logApprovalEvent({\n              missionId, stageId: `stage_${stage.stage}`, round: result.rounds,\n              agentRole: 'artifact_ledger', agentId: 'artifact_ledger',\n              action: 'handoff_failed', feedback: String(handoffError?.message ?? handoffError).slice(0, 500),\n            })\n            return { missionId, pipelineType: pipeline.type, success: false, stages, error: `Artifact handoff failed after Stage ${stage.stage}: ${String(handoffError?.message ?? handoffError).slice(0, 300)}` }\n          }\n        }\n      }")

# Ledger-write failures must stop a mission that claims evidence-backed completion.
replace_once('src/lib/mission-pipeline.ts',
    "      } catch {}\n\n      return {\n        output: teamOutput,\n        rounds: round,",
    "      } catch (artifactError: any) {\n        throw new Error(`CEO artifact registration failed: ${String(artifactError?.message ?? artifactError).slice(0, 300)}`)\n      }\n\n      return {\n        output: teamOutput,\n        rounds: round,")
replace_once('src/lib/mission-pipeline.ts',
    "    if (artifactVerified) await verifyArtifact(artifactId, lastVerification?.score ?? 0, 'super_agent', 'verified')\n  } catch {}",
    "    if (artifactVerified) await verifyArtifact(artifactId, lastVerification?.score ?? 0, 'super_agent', 'verified')\n  } catch (artifactError: any) {\n    throw new Error(`Artifact ledger registration failed for stage ${stage.stage}: ${String(artifactError?.message ?? artifactError).slice(0, 300)}`)\n  }")

print('Hierarchy + Artifact Ledger hardening patches applied.')
