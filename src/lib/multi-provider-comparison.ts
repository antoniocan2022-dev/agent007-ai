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
 * This is a lightweight wrapper that calls the provider's function
 * and normalizes the result.
 */
async function callProvider(
  provider: string,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
): Promise<ProviderResponse> {
  const start = Date.now()
  // UPGRADE #169 H1: Restore LLM_PROVIDER_ORDER in finally, not in try.
  // Before: if callLlmWithRetry threw (rate limit, network, auth), the restore
  // at the end of the try block never ran → the env var stayed mutated for
  // the lifetime of the Vercel warm Lambda → ALL subsequent LLM calls across
  // ALL concurrent requests used ONLY that one provider (single-provider
  // bottleneck under load).
  // After: try/finally guarantees the env is restored even on throw.
  const originalOrder = process.env.LLM_PROVIDER_ORDER
  try {
    // Dynamically import to avoid circular dependencies
    const { callLlmWithRetry } = await import('./agent')

    // Temporarily set LLM_PROVIDER_ORDER to only use this provider
    process.env.LLM_PROVIDER_ORDER = provider

    const result = await callLlmWithRetry(messages)
    const content = result?.choices?.[0]?.message?.content ?? ''
    const reasoning = result?._reasoning || result?.choices?.[0]?.message?.reasoning || null
    const model = result?._model || provider

    return {
      provider,
      model,
      content,
      reasoning,
      ok: !!content,
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
  } finally {
    // UPGRADE #169 H1 + #170 fix: If originalOrder was undefined (env not set),
    // we must DELETE the env var — assigning undefined coerces to the literal
    // string "undefined" (Node.js quirk), which would then be parsed by
    // callLlmWithRetry as order=['undefined'], zero providers available,
    // ALL subsequent LLM calls fail. This was a regression introduced by #169 H1.
    if (originalOrder === undefined) {
      delete process.env.LLM_PROVIDER_ORDER
    } else {
      process.env.LLM_PROVIDER_ORDER = originalOrder
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
 * Available providers (when configured):
 *   mistral, groq, openrouter, cerebras, brave, gemini
 *
 * (OpenAI and z.ai are disabled per UPGRADE #123)
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
      case 'brave': return !!process.env.BRAVE_API_KEY
      case 'gemini': return !!process.env.GEMINI_API_KEY
      default: return false
    }
  })

  if (availableProviders.length === 0) {
    return {
      ok: false,
      preview: 'No configured providers available',
      result: 'Error: None of the requested providers have API keys configured. Set at least one of: MISTRAL_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY, CEREBRAS_API_KEY, BRAVE_API_KEY, GEMINI_API_KEY',
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
    availableProviders.map((p: string) => callProvider(p.toLowerCase(), messages))
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
    report += `The fastest provider was: ${succeeded.sort((a, b) => a.elapsedMs - b.elapsedMs)[0].provider} (${succeeded[0].elapsedMs}ms)\n`
    report += `The longest response was from: ${succeeded.sort((a, b) => b.content.length - a.content.length)[0].provider} (${succeeded[0].content.length} chars)\n`
  }

  return {
    ok: true,
    preview: `Multi-provider comparison: ${succeeded.length}/${results.length} succeeded`,
    result: report,
  }
}

/**
 * Self-Decision Provider Selection
 *
 * Lets the agent choose the BEST provider for a specific task based on
 * task characteristics. This is called automatically by the orchestrator
 * when the agent needs an LLM response.
 *
 * Selection criteria (no strict order — agent decides):
 *   - Speed-critical tasks (real-time chat, quick lookups) → Cerebras (2600 tok/s)
 *   - Complex reasoning (analysis, strategy) → Mistral (large model, strong reasoning)
 *   - Long-form content (blogs, reports) → OpenRouter (access to many models)
 *   - Creative tasks (brainstorming, naming) → Groq (Llama 3, good at creative)
 *   - Search-related (trends, news) → Brave (search-optimized)
 *   - Multi-modal (images, vision) → Gemini (native vision support)
 */
export function selectBestProvider(taskDescription: string): string[] {
  const lower = taskDescription.toLowerCase()

  // Task-type → preferred providers (in priority order)
  const taskProviderMap: Array<{ patterns: RegExp[]; providers: string[] }> = [
    {
      patterns: [/fast|quick|real.?time|immediate|speed/],
      providers: ['cerebras', 'groq'],  // Cerebras 2600 tok/s, Groq also fast
    },
    {
      patterns: [/analyz|reason|strategy|compar|evaluat|decide/],
      providers: ['mistral', 'openrouter'],  // Large models, strong reasoning
    },
    {
      patterns: [/writ|blog|article|report|content|essay/],
      providers: ['openrouter', 'mistral'],  // Access to many models for long-form
    },
    {
      patterns: [/creat|brainstorm|idea|name|slogan/],
      providers: ['groq', 'mistral'],  // Llama 3 good at creative
    },
    {
      patterns: [/search|trend|news|current|latest/],
      providers: ['brave', 'groq'],  // Brave search-optimized
    },
    {
      patterns: [/image|vision|picture|see|visual/],
      providers: ['gemini'],  // Native vision support
    },
  ]

  // Find matching task type
  for (const { patterns, providers } of taskProviderMap) {
    if (patterns.some((p) => p.test(lower))) {
      // Filter to only configured providers
      const configured = providers.filter((p) => {
        switch (p) {
          case 'mistral': return !!process.env.MISTRAL_API_KEY
          case 'groq': return !!process.env.GROQ_API_KEY
          case 'openrouter': return !!process.env.OPENROUTER_API_KEY
          case 'cerebras': return !!process.env.CEREBRAS_API_KEY
          case 'brave': return !!process.env.BRAVE_API_KEY
          case 'gemini': return !!process.env.GEMINI_API_KEY
          default: return false
        }
      })
      if (configured.length > 0) return configured
    }
  }

  // Default: all configured providers (agent self-selects)
  const all: string[] = []
  if (process.env.MISTRAL_API_KEY) all.push('mistral')
  if (process.env.GROQ_API_KEY) all.push('groq')
  if (process.env.OPENROUTER_API_KEY) all.push('openrouter')
  if (process.env.CEREBRAS_API_KEY) all.push('cerebras')
  if (process.env.BRAVE_API_KEY) all.push('brave')
  if (process.env.GEMINI_API_KEY) all.push('gemini')
  return all
}
