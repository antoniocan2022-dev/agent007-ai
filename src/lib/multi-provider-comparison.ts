/**
 * multi-provider-comparison.ts — UPGRADE #123
 * ====================================================================
 * Lets the super agent + all 20 subagents query MULTIPLE LLM providers
 * in parallel and compare their responses. The agent can then form its
 * own analysis by synthesizing insights from multiple sources.
 *
 * This addresses the owner's request:
 *   "they can compare several data from several providers and they can
 *    create or form their own analysis"
 *
 * Usage from the agent's tool registry:
 *   <tool name="multi_provider_compare">
 *     {"prompt":"What's the best affiliate strategy for AI tools?","providers":["mistral","groq","openrouter"]}
 *   </tool>
 *
 * The tool returns all responses side-by-side so the agent can:
 *   1. Identify consensus (all providers agree)
 *   2. Identify disagreements (providers differ — investigate why)
 *   3. Synthesize a final answer that incorporates the best insights
 */
import type { ToolResult } from './tools'
import { PROVIDER_ORDER, type ActiveProviderId } from './provider-control-plane'

interface ProviderResponse {
  provider: string
  model: string
  content: string
  reasoning?: string | null
  ok: boolean
  error?: string
  elapsedMs: number
}

/**
 * Call a single provider. Returns the response or error.
 *
 * Provider Gateway Phase C (2026-09-19): this used to isolate a provider by mutating
 * process.env.LLM_PROVIDER_ORDER around a call to agent.ts's legacy retry wrapper (see UPGRADE
 * #169/#170's try/finally dance in git history). That mechanism was a no-op by the time this
 * ran: the legacy wrapper delegates straight to runCanonicalLlm, which never reads
 * LLM_PROVIDER_ORDER at all (the canonical router picks providers via its own task-governed
 * candidate/health ranking) -- so every call here silently ignored the requested provider and
 * got whichever provider the router's own
 * ranking happened to choose, while still labeling the response with the REQUESTED provider's
 * name. A "multi-provider comparison" report could show three different-looking responses all
 * secretly answered by the same one provider under three false labels, defeating the entire
 * point of the tool. runCanonicalLlm's excludeProviders is a real, request-scoped parameter (no
 * shared-Lambda race risk the env mutation had to work around in the first place): excluding
 * every OTHER governed provider leaves exactly one candidate in the pool from the very first
 * filtering step, so it fails honestly if that provider isn't currently available rather than
 * silently substituting another one -- and the label now comes from the result actually
 * returned, not the request. (providerOrder alone is not strict enough for this: it's a
 * preference ranking, not an allowlist, and runGovernedProviderChat's half-open-probe fallback
 * path can still pick a DIFFERENT durably-available provider outside that order when every
 * providerOrder candidate's circuit is open -- excludeProviders is filtered before that path
 * ever runs, so it has no such gap.)
 */
async function callProvider(
  provider: ActiveProviderId,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
): Promise<ProviderResponse> {
  const start = Date.now()
  try {
    const { runCanonicalLlm } = await import('./canonical-llm-router')
    const result = await runCanonicalLlm({ messages, excludeProviders: PROVIDER_ORDER.filter((candidate) => candidate !== provider), maxProviderAttempts: 1, taskType: 'reasoning', verification: 'standard' })
    return {
      provider: result.provider,
      model: result.model,
      content: result.content,
      reasoning: null,
      ok: !!result.content,
      elapsedMs: Date.now() - start,
    }
  } catch (e: any) {
    return {
      provider,
      model: provider,
      content: '',
      ok: false,
      error: e?.message?.slice(0, 200) || 'Unknown error',
      elapsedMs: Date.now() - start,
    }
  }
}

/**
 * Multi-Provider Comparison Tool
 *
 * Queries multiple LLM providers in parallel and returns their responses
 * side-by-side for comparison. The agent can then synthesize its own
 * analysis from the different perspectives.
 *
 * Available providers (when configured): mistral, groq, openrouter, cerebras, cloudflare --
 * the same 5 governed providers provider-control-plane.ts defines (openai is excluded there;
 * brave/gemini were never wired into the actual provider switch below despite once being
 * mentioned here).
 */
export async function toolMultiProviderCompare(args: any): Promise<ToolResult> {
  const { prompt, providers = ['mistral', 'groq', 'openrouter'], systemPrompt } = args ?? {}

  if (!prompt) {
    return {
      ok: false,
      preview: 'multi_provider_compare requires "prompt"',
      result: 'Error: multi_provider_compare requires a "prompt" argument.',
    }
  }

  // Filter to only providers that have API keys configured
  const availableProviders = providers.filter((p: string) => {
    switch (p.toLowerCase()) {
      case 'mistral': return !!process.env.MISTRAL_API_KEY
      case 'groq': return !!process.env.GROQ_API_KEY
      case 'openrouter': return !!process.env.OPENROUTER_API_KEY
      case 'cerebras': return !!process.env.CEREBRAS_API_KEY
      
      case 'cloudflare': return !!(process.env.CLOUDFLARE_API_KEY && process.env.CLOUDFLARE_ACCOUNT_ID)
      default: return false
    }
  })

  if (availableProviders.length === 0) {
    return {
      ok: false,
      preview: 'No configured providers available',
      result: 'Error: None of the requested providers have API keys configured. Set at least one of: MISTRAL_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY, CEREBRAS_API_KEY, CLOUDFLARE_API_KEY (+ CLOUDFLARE_ACCOUNT_ID)',
    }
  }

  // Build messages
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = []
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt })
  }
  messages.push({ role: 'user', content: prompt })

  // Call all providers in PARALLEL
  const results = await Promise.all(
    availableProviders.map((p: string) => callProvider(p.toLowerCase() as ActiveProviderId, messages))
  )

  // Build the comparison report
  const succeeded = results.filter((r) => r.ok)
  const failed = results.filter((r) => !r.ok)

  let report = `MULTI-PROVIDER COMPARISON REPORT\n${'='.repeat(60)}\n\n`
  report += `Prompt: "${prompt.slice(0, 200)}${prompt.length > 200 ? '...' : ''}"\n`
  report += `Providers queried: ${availableProviders.length} (${availableProviders.join(', ')})\n`
  report += `Succeeded: ${succeeded.length} | Failed: ${failed.length}\n`
  report += `Total elapsed: ${Math.max(...results.map((r) => r.elapsedMs))}ms (parallel)\n\n`

  report += `${'─'.repeat(60)}\nRESPONSES:\n${'─'.repeat(60)}\n\n`

  for (const r of results) {
    report += `┌── ${r.provider.toUpperCase()} (${r.model}) — ${r.elapsedMs}ms — ${r.ok ? '✓ SUCCESS' : '✗ FAILED'}\n`
    if (r.ok) {
      report += `│\n`
      // Show reasoning if available (truncated)
      if (r.reasoning) {
        report += `│ REASONING:\n`
        const reasoningLines = r.reasoning.slice(0, 500).split('\n')
        for (const line of reasoningLines) {
          report += `│   ${line}\n`
        }
        report += `│\n`
      }
      // Show content (truncated to 2000 chars per provider)
      const content = r.content.slice(0, 2000)
      const contentLines = content.split('\n')
      for (const line of contentLines) {
        report += `│ ${line}\n`
      }
    } else {
      report += `│ ERROR: ${r.error}\n`
    }
    report += `└${'─'.repeat(58)}\n\n`
  }

  // Consensus analysis
  if (succeeded.length >= 2) {
    report += `${'─'.repeat(60)}\nCONSENSUS ANALYSIS:\n${'─'.repeat(60)}\n\n`
    report += `You now have ${succeeded.length} responses from different AI providers.\n`
    report += `Use these to:\n`
    report += `1. IDENTIFY CONSENSUS — What do all/most providers agree on?\n`
    report += `2. IDENTIFY DISAGREEMENTS — Where do providers differ? Investigate why.\n`
    report += `3. SYNTHESIZE — Combine the best insights from each into your final answer.\n`
    report += `4. CITATION — When you use a specific insight, mention which provider suggested it.\n\n`
    // Fresh-audit fix: this used to re-sort `succeeded` in place (twice, with two different
    // comparators) and read `succeeded[0]` back out afterward -- correct only because each
    // sort's mutation happened to land immediately before the read that depended on it. That's a
    // fragile hidden coupling between statement order and Array.prototype.sort's in-place
    // mutation, not an actual guarantee; reduce() states the intent directly and doesn't depend
    // on evaluation order between unrelated-looking expressions.
    const fastest = succeeded.reduce((min, r) => (r.elapsedMs < min.elapsedMs ? r : min))
    const longest = succeeded.reduce((max, r) => (r.content.length > max.content.length ? r : max))
    report += `The fastest provider was: ${fastest.provider} (${fastest.elapsedMs}ms)\n`
    report += `The longest response was from: ${longest.provider} (${longest.content.length} chars)\n`
  }

  return {
    ok: true,
    preview: `Multi-provider comparison: ${succeeded.length}/${results.length} succeeded`,
    result: report,
  }
}

