import { db } from '@/lib/db'
import { internalUrl } from "./internal-url"
import { runSystemAudit, getCapabilities, getManifest, testCommunication, runSelfHeal } from "./system-functions"
import { verifyToolAction } from "./tool-action-verification"
import { getCanonicalOrganizationPrompt } from './canonical-organization-prompt'

// Helper: fetch internal URL with better error handling for Vercel
async function internalFetch(url: string, options?: any): Promise<any> {
  try {
    const res = await fetch(url, {
      ...options,
      redirect: 'follow',
      signal: options?.signal ?? AbortSignal.timeout(15000),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}`, _httpError: true }
    }
    const contentType = res.headers.get('content-type') || ''
    if (!contentType.includes('application/json')) {
      const text = await res.text().catch(() => '')
      return { ok: false, error: `Non-JSON response (${contentType}): ${text.slice(0, 100)}`, _parseError: true }
    }
    return await res.json().catch(() => ({}))
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e), _fetchError: true }
  }
}

import { dispatchTool, type AttachmentMeta, type ToolContext, type ToolResult } from '@/lib/tools'

const ORCHESTRATOR_PROMPT_ADDENDUM = `
ORCHESTRATION:
You orchestrate the canonical organization defined by the Agent007 organization graph. For multi-step tasks, dispatch leaders and specialists using identities present in the canonical organization context.
<dispatch agent="scout" task="find 3 trending AI niches"/>
Max 3 dispatches per turn, then synthesize into a final answer.

${getCanonicalOrganizationPrompt()}

MISSION PIPELINE (hierarchical verification):
Type "start mission: <type>: <objective>" to run a full pipeline.
Types: product_launch, content_creation, affiliate_campaign, generic.
`
