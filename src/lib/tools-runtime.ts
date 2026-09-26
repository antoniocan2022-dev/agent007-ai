/**
 * Canonical governed tool-dispatch boundary.
 * Every tool attempt is recorded through the mandatory execution contract.
 */
import { randomUUID } from 'node:crypto'
import {
  dispatchTool as rawDispatchTool,
  badResult,
  type ToolContext,
  type ToolResult,
} from './tools'
import { classifyToolExecutionDetailed, autonomyDenialMessage } from './autonomy/autonomy-runtime'
import { getVerifiedOwnerAuthorization, isVerifiedOwnerAuthorization } from './autonomy/owner-authorization'
import { startMandatoryExecution, completeMandatoryExecution } from './execution-contract'

export * from './tools'

export type AuthorizedToolContext = ToolContext & {
  ownerAuthorization?: unknown
  missionId?: string
  actorId?: string
  actorType?: string
  executionIdempotencyKey?: string
}

type ProvenToolResult = ToolResult & {
  executionProof?: {
    receiptId: string
    missionId: string
    scope: 'mission' | 'unscoped'
    status: 'SUCCESS' | 'FAILED' | 'DENIED'
    requestHash: string
    outputReference?: string
  }
}

function buildIdempotencyKey(context: AuthorizedToolContext, toolName: string): string {
  return context.executionIdempotencyKey?.trim() || `tool:${context.missionId ?? 'unscoped'}:${toolName}:${randomUUID()}`
}

// Not to be confused with tools.ts's own dispatchTool, which takes a plain ToolContext --
// this one requires an AuthorizedToolContext and layers execution-receipt/proof-ledger
// recording on top. Import from here for any governed/mission-scoped call path.
export async function dispatchTool(
  name: string,
  args: any,
  ctx: AuthorizedToolContext,
): Promise<ProvenToolResult> {
  const startedAt = new Date()
  const execution = await startMandatoryExecution({
    missionId: ctx.missionId,
    conversationId: ctx.conversationId,
    actorId: ctx.actorId ?? name,
    actorType: ctx.actorType ?? 'tool',
    action: `tool.${name}`,
    idempotencyKey: buildIdempotencyKey(ctx, name),
    args: { tool: name, args: args ?? {} },
  })

  const finish = async (
    status: 'SUCCESS' | 'FAILED' | 'DENIED',
    output: unknown,
    errorCode?: string,
  ) => {
    const completed = await completeMandatoryExecution({
      receiptId: execution.receipt.id,
      missionId: execution.scope.missionId,
      status,
      requestHash: execution.requestHash,
      output,
      errorCode,
      metadata: {
        executionScope: execution.scope.scope,
        tool: name,
        conversationId: ctx.conversationId ?? null,
        startedAt: startedAt.toISOString(),
      },
    })
    return {
      receiptId: execution.receipt.id,
      missionId: execution.scope.missionId,
      scope: execution.scope.scope,
      status,
      requestHash: execution.requestHash,
      outputReference: completed.outputReference,
    } as const
  }

  let ownerAuthorization = isVerifiedOwnerAuthorization(ctx.ownerAuthorization)
    ? ctx.ownerAuthorization
    : null
  if (!ownerAuthorization) {
    try {
      ownerAuthorization = await getVerifiedOwnerAuthorization()
    } catch {
      ownerAuthorization = null
    }
  }

  const { decision, actionClass } = classifyToolExecutionDetailed(name, args, {
    confidence: 1,
    ownerAuthorization,
  })

  if (!decision.authorizedForExecution) {
    const denied = badResult(autonomyDenialMessage(name, decision))
    const executionProof = await finish('DENIED', { ok: denied.ok, result: denied.result, preview: denied.preview }, 'AUTONOMY_DENIED')
    return { ...denied, executionProof }
  }

  // Self-repair follow-up (2026-09-26): records real graduation evidence under the tool's actual
  // ActionClass (see classifyToolExecutionDetailed) so MEDIUM_RISK/HIGH_RISK/IRREVERSIBLE work can
  // finally accumulate the evidence autonomy-graduation.ts's ledger needs to score it -- every
  // governed call previously only ever fed LOW_RISK via a single, separate heartbeat site. Deliberately
  // fire-and-forget and fully swallowed: this is observability feeding a slow-moving graduation ledger,
  // never allowed to add latency or failure risk to the actual tool call it's reporting on.
  const recordGraduationEvidence = (successful: boolean) => {
    import('./autonomy-graduation').then(({ recordAutonomyEvidence }) => recordAutonomyEvidence({
      actionClass,
      attempts: 1,
      successes: successful ? 1 : 0,
      source: `tool:${name}`,
      idempotencyKey: execution.receipt.id,
    })).catch(() => {})
  }

  try {
    const result = await rawDispatchTool(name, args, ctx)
    recordGraduationEvidence(result.ok)
    const executionProof = await finish(
      result.ok ? 'SUCCESS' : 'FAILED',
      { ok: result.ok, result: result.result, preview: result.preview, artifacts: result.artifacts ?? null },
      result.ok ? undefined : 'TOOL_FAILED',
    )
    return { ...result, executionProof }
  } catch (error) {
    recordGraduationEvidence(false)
    const message = error instanceof Error ? error.message : String(error)
    const executionProof = await finish('FAILED', { error: message.slice(0, 500) }, 'TOOL_THROW')
    throw Object.assign(error instanceof Error ? error : new Error(message), { executionProof })
  }
}
