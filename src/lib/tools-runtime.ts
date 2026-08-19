/**
 * Canonical tool-dispatch boundary for Agent007.
 *
 * `src/lib/tools.ts` remains the implementation/registry module. The `@/lib/tools`
 * TypeScript path resolves here, so governed callers enter through this boundary
 * without duplicating the canonical registry.
 *
 * Safety rule: LLM-provided arguments never count as authorization evidence.
 * Capability metadata is the source of autonomous eligibility; unknown tools
 * remain conservative and require approval.
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
import { recordExecutionReceipt, sha256 } from './proof-ledger'

export * from './tools'

type AuthorizedToolContext = ToolContext & {
  ownerAuthorization?: unknown
  missionId?: string
  actorId?: string
  actorType?: string
  executionIdempotencyKey?: string
}

async function recordToolExecution(
  context: AuthorizedToolContext,
  name: string,
  args: any,
  status: string,
  startedAt: Date,
  result?: ToolResult,
  errorCode?: string,
): Promise<void> {
  const missionId = context.missionId
  // Do not fabricate mission identity. Non-mission tool calls remain backward
  // compatible and simply do not produce mission-scoped execution receipts.
  if (!missionId) return

  const requestHash = sha256({ tool: name, args: args ?? {} })
  const outputHash = result
    ? sha256({ ok: result.ok, result: result.result, preview: result.preview })
    : undefined
  const idempotencyKey = context.executionIdempotencyKey ?? `attempt_${randomUUID()}`

  await recordExecutionReceipt({
    missionId,
    actorId: context.actorId ?? name,
    actorType: context.actorType ?? 'tool',
    action: `tool.${name}`,
    status,
    idempotencyKey,
    requestHash,
    inputReference: `tool-input-sha256:${requestHash}`,
    outputReference: outputHash ? `tool-output-sha256:${outputHash}` : undefined,
    errorCode,
    startedAt,
    completedAt: new Date(),
    metadata: {
      tool: name,
      conversationId: context.conversationId ?? null,
    },
  })
}

export async function dispatchTool(
  name: string,
  args: any,
  ctx: AuthorizedToolContext,
): Promise<ToolResult> {
  const startedAt = new Date()

  let ownerAuthorization = isVerifiedOwnerAuthorization(ctx.ownerAuthorization)
    ? ctx.ownerAuthorization
    : null
  if (!ownerAuthorization) {
    try {
      ownerAuthorization = await getVerifiedOwnerAuthorization()
    } catch {
      // Missing/unavailable session fails closed; autonomous-safe actions can
      // still proceed because they do not require owner authorization.
      ownerAuthorization = null
    }
  }

  const decision = classifyToolExecution(name, args, {
    confidence: 1,
    ownerAuthorization,
  })

  if (!decision.authorizedForExecution) {
    const denied = badResult(autonomyDenialMessage(name, decision))
    await recordToolExecution(ctx, name, args, 'DENIED', startedAt, denied, 'AUTONOMY_DENIED')
    return denied
  }

  try {
    const result = await rawDispatchTool(name, args, ctx)
    await recordToolExecution(
      ctx,
      name,
      args,
      result.ok ? 'SUCCESS' : 'FAILED',
      startedAt,
      result,
      result.ok ? undefined : 'TOOL_FAILED',
    )
    return result
  } catch (error) {
    await recordToolExecution(ctx, name, args, 'FAILED', startedAt, undefined, 'TOOL_THROW')
    throw error
  }
}
