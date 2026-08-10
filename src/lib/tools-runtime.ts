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

import {
  dispatchTool as rawDispatchTool,
  badResult,
  type ToolContext,
  type ToolResult,
} from './tools'
import { classifyToolExecution, autonomyDenialMessage } from './autonomy/autonomy-runtime'
import { getVerifiedOwnerAuthorization, isVerifiedOwnerAuthorization } from './autonomy/owner-authorization'

export * from './tools'

type AuthorizedToolContext = ToolContext & {
  ownerAuthorization?: unknown
}

export async function dispatchTool(
  name: string,
  args: any,
  ctx: ToolContext,
): Promise<ToolResult> {
  // Do not maintain a second allow-list here. Capability metadata is the
  // authoritative eligibility contract, while the Governor remains the final
  // policy decision. Unknown tools therefore cannot become autonomous by being
  // forgotten in a local allow-list.
  const authorizedContext = ctx as AuthorizedToolContext

  // Owner authorization is resolved server-side from the authenticated
  // NextAuth session. A caller-provided boolean or arbitrary object is never
  // accepted as proof of approval.
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
    return badResult(autonomyDenialMessage(name, decision))
  }

  return rawDispatchTool(name, args, ctx)
}
