/**
 * Canonical tool-dispatch boundary for Agent007.
 *
 * `src/lib/tools.ts` remains the implementation/registry module. This wrapper
 * is intentionally thin and is selected only for the `@/lib/tools` import
 * alias, so the authoritative orchestrator path cannot bypass the Autonomy
 * Governor accidentally.
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
  // Proof records are mission-scoped by design. Until an orchestrator provides
  // a missionId, do not invent a fake mission identity or pollute the ledger.
  const missionId = context.missionId
  if (!missionId) return

  const requestHash = sha256({ tool: name, args: args ?? {} })
  const outputHash = result ? sha256({ ok: result.ok, result: result.result, preview: result.preview }) : undefined
  const idempotencyKey = context.executionIdempotencyKey ?? `attempt_${randomUUID()}`

  await recordExecutionReceipt({
    missionId,
    userId: undefined,
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
    metadata: { tool: name, conversationId: context.conversationId ?? null },
  })
}

export async function dispatchTool(
  name: string,
  args: any,
  ctx: ToolContext,
): Promise<ToolResult> {
  const authorizedContext = ctx as AuthorizedToolContext
  const startedAt = new Date()

  let ownerAuthorization = isVerifiedOwnerAuthorization(authorizedContext.ownerAuthorization)
    ? authorizedContext.ownerAuthorization
    : null
  if (!ownerAuthorization) {
    try {
      ownerAuthorization = await getVerifiedOwnerAuthorization()
    } catch {
      // A missing/unavailable session must fail closed; autonomous-safe actions
      // can still proceed because they do not require owner authorization.
      ownerAuthorization = null
    }
  }

  const decision = classifyToolExecution(name, args, {
    confidence: 1,
    ownerAuthorization,
  })

  if (!decision.authorizedForExecution) {
    const denied = badResult(autonomyDenialMessage(name, decision))
    await recordToolExecution(authorizedContext, name, args, 'DENIED', startedAt, denied, 'AUTONOMY_DENIED')
    return denied
  }

  try {
    const result = await rawDispatchTool(name, args, ctx)
    await recordToolExecution(authorizedContext, name, args, result.ok ? 'SUCCESS' : 'FAILED', startedAt, result, result.ok ? undefined : 'TOOL_FAILED')
    return result
  } catch (error) {
    await recordToolExecution(authorizedContext, name, args, 'FAILED', startedAt, undefined, 'TOOL_THROW')
    throw error
  }
}
