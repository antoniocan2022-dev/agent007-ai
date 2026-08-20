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
 *
 * Phase 1/Truthfulness hardening:
 * - every tool attempt receives an execution receipt before execution;
 * - the receipt is completed after the tool returns;
 * - unscoped calls use an explicit `unscoped:` execution scope rather than
 *   pretending they belong to a mission;
 * - the LLM-facing result contains the receipt status so execution claims remain
 *   grounded in persisted proof.
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
import { sha256 } from './proof-ledger'
import {
  completeMandatoryExecution,
  executionProofText,
  startMandatoryExecution,
} from './execution-contract'

export * from './tools'

type AuthorizedToolContext = ToolContext & {
  ownerAuthorization?: unknown
  missionId?: string
  actorId?: string
  actorType?: string
  executionIdempotencyKey?: string
}

function withExecutionProof(result: ToolResult, proof: {
  receiptId: string
  missionId: string
  scope: 'mission' | 'unscoped'
  status: 'STARTED' | 'SUCCESS' | 'FAILED' | 'DENIED'
  requestHash: string
  outputReference?: string
}): ToolResult {
  const text = executionProofText(proof)
  return {
    ...result,
    preview: `${result.preview}\n${text}`,
    result: `${result.result}\n\n${text}`,
  }
}

export async function dispatchTool(
  name: string,
  args: any,
  ctx: AuthorizedToolContext,
): Promise<ToolResult> {
  const requestHash = sha256({ tool: name, args: args ?? {} })
  const execution = await startMandatoryExecution({
    missionId: ctx.missionId,
    conversationId: ctx.conversationId,
    actorId: ctx.actorId ?? name,
    actorType: ctx.actorType ?? 'tool',
    action: `tool.${name}`,
    idempotencyKey: ctx.executionIdempotencyKey ?? `attempt:${randomUUID()}`,
    args: { tool: name, args: args ?? {} },
  })

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
    let proof
    try {
      proof = await completeMandatoryExecution({
        receiptId: execution.receipt.id,
        missionId: execution.scope.missionId,
        status: 'DENIED',
        requestHash,
        output: { ok: false, result: denied.result },
        errorCode: 'AUTONOMY_DENIED',
        metadata: {
          tool: name,
          executionScope: execution.scope.scope,
          conversationId: ctx.conversationId ?? null,
        },
      })
    } catch {
      // The STARTED receipt still proves the attempted action reached the
      // governed boundary. Never execute a denied action just because final
      // receipt completion failed.
      return withExecutionProof(denied, {
        receiptId: execution.receipt.id,
        missionId: execution.scope.missionId,
        scope: execution.scope.scope,
        status: 'STARTED',
        requestHash,
      })
    }
    return withExecutionProof(denied, {
      receiptId: proof.receipt.id,
      missionId: execution.scope.missionId,
      scope: execution.scope.scope,
      status: 'DENIED',
      requestHash,
    })
  }

  try {
    const result = await rawDispatchTool(name, args, ctx)
    try {
      const proof = await completeMandatoryExecution({
        receiptId: execution.receipt.id,
        missionId: execution.scope.missionId,
        status: result.ok ? 'SUCCESS' : 'FAILED',
        requestHash,
        output: { ok: result.ok, result: result.result, preview: result.preview },
        errorCode: result.ok ? undefined : 'TOOL_FAILED',
        metadata: {
          tool: name,
          executionScope: execution.scope.scope,
          conversationId: ctx.conversationId ?? null,
        },
      })
      return withExecutionProof(result, {
        receiptId: proof.receipt.id,
        missionId: execution.scope.missionId,
        scope: execution.scope.scope,
        status: result.ok ? 'SUCCESS' : 'FAILED',
        requestHash,
        outputReference: proof.outputReference,
      })
    } catch {
      return withExecutionProof(
        {
          ...result,
          ok: false,
          preview: `${result.preview}\nExecution proof persistence is incomplete; do not claim this operation is verified.`,
          result: `${result.result}\n\nExecution proof persistence is incomplete; the operation has not reached a VERIFIED execution state.`,
        },
        {
          receiptId: execution.receipt.id,
          missionId: execution.scope.missionId,
          scope: execution.scope.scope,
          status: 'STARTED',
          requestHash,
        },
      )
    }
  } catch (error) {
    try {
      const proof = await completeMandatoryExecution({
        receiptId: execution.receipt.id,
        missionId: execution.scope.missionId,
        status: 'FAILED',
        requestHash,
        errorCode: 'TOOL_THROW',
        metadata: {
          tool: name,
          executionScope: execution.scope.scope,
          conversationId: ctx.conversationId ?? null,
        },
      })
      void proof
    } catch {
      // Preserve the original tool exception. The STARTED receipt remains the
      // durable evidence that execution entered the governed boundary.
    }
    throw error
  }
}
