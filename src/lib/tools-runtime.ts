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
import { classifyToolExecution, autonomyDenialMessage } from './autonomy/autonomy-runtime'
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

function buildIdempotencyKey(context: AuthorizedToolContext, toolName: string): string {
  return context.executionIdempotencyKey?.trim() || `tool:${context.missionId ?? 'unscoped'}:${toolName}:${randomUUID()}`
}

export async function dispatchTool(
  name: string,
  args: any,
  ctx: AuthorizedToolContext,
): Promise<ToolResult> {
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
    await completeMandatoryExecution({
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

  const decision = classifyToolExecution(name, args, {
    confidence: 1,
    ownerAuthorization,
  })

  if (!decision.authorizedForExecution) {
    const denied = badResult(autonomyDenialMessage(name, decision))
    await finish('DENIED', { ok: denied.ok, result: denied.result, preview: denied.preview }, 'AUTONOMY_DENIED')
    return denied
  }

  try {
    const result = await rawDispatchTool(name, args, ctx)
    await finish(
      result.ok ? 'SUCCESS' : 'FAILED',
      { ok: result.ok, result: result.result, preview: result.preview },
      result.ok ? undefined : 'TOOL_FAILED',
    )
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await finish('FAILED', { error: message.slice(0, 500) }, 'TOOL_THROW')
    throw error
  }
}
