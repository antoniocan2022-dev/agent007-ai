/**
 * /api/health/llm-providers — UPGRADE #113
 * Returns the LIVE state of all configured LLM providers + the active order.
 * Use this to verify which providers Vercel currently has env vars for.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const isVercel = !!(process.env.VERCEL || process.env.NOW)
  const configuredOrder = (process.env.LLM_PROVIDER_ORDER || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  // UPGRADE #114 — must match src/lib/agent.ts DEFAULT_ORDER
  // UPGRADE #123: New default order — OpenAI + z.ai disabled, Cerebras added
  const DEFAULT_ORDER = ['mistral', 'groq', 'openrouter', 'cerebras', 'brave', 'gemini']
  const order = configuredOrder.length > 0 ? configuredOrder : DEFAULT_ORDER

  // UPGRADE #120 — Security fix: Do NOT show any key fingerprint.
  // Previously showed first 4 + last 4 chars + length, which reduced the
  // keyspace for brute-force attacks. Now shows only whether the key is set.
  const mask = (key: string | undefined): string => {
    return key ? '(configured)' : '(not set)'
  }

  const providers = [
    {
      id: 'openai',
      name: 'OpenAI (gpt-4o)',
      envVar: 'OPENAI_API_KEY',
      configured: !!process.env.OPENAI_API_KEY,
      keyPreview: mask(process.env.OPENAI_API_KEY),
      model: process.env.OPENAI_MODEL || 'gpt-4o',
      baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1/chat/completions',
      inOrder: order.includes('openai'),
      willRun: order.includes('openai') && !!process.env.OPENAI_API_KEY,
      notes: 'Primary with retries. UPGRADE #112: fast-fails on 403/401/region errors.',
    },
    {
      id: 'mistral',
      name: 'Mistral AI (mistral-large-latest)',
      envVar: 'MISTRAL_API_KEY',
      configured: !!process.env.MISTRAL_API_KEY,
      keyPreview: mask(process.env.MISTRAL_API_KEY),
      model: 'mistral-large-latest',
      baseUrl: 'https://api.mistral.ai/v1/chat/completions',
      inOrder: order.includes('mistral'),
      willRun: order.includes('mistral') && !!process.env.MISTRAL_API_KEY,
      notes: 'Recommended primary on Vercel iad1. Works from any region.',
    },
    {
      id: 'groq',
      name: 'Groq (Llama 3 / Mixtral)',
      envVar: 'GROQ_API_KEY',
      configured: !!process.env.GROQ_API_KEY,
      keyPreview: mask(process.env.GROQ_API_KEY),
      model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
      baseUrl: 'https://api.groq.com/openai/v1/chat/completions',
      inOrder: order.includes('groq'),
      willRun: order.includes('groq') && !!process.env.GROQ_API_KEY,
      notes: 'Ultra-fast inference. US region-friendly.',
    },
    {
      id: 'openrouter',
      name: 'OpenRouter (multi-model)',
      envVar: 'OPENROUTER_API_KEY',
      configured: !!process.env.OPENROUTER_API_KEY,
      keyPreview: mask(process.env.OPENROUTER_API_KEY),
      model: 'meta-llama/llama-3.3-70b-instruct:free',
      baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
      inOrder: order.includes('openrouter'),
      willRun: order.includes('openrouter') && !!process.env.OPENROUTER_API_KEY,
      notes: 'Aggregator — has free models. Good last-resort fallback.',
    },
    {
      id: 'gemini',
      name: 'Google Gemini',
      envVar: 'GEMINI_API_KEY',
      configured: !!process.env.GEMINI_API_KEY,
      keyPreview: mask(process.env.GEMINI_API_KEY),
      model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      inOrder: order.includes('gemini'),
      willRun: order.includes('gemini') && !!process.env.GEMINI_API_KEY,
      notes: 'Often region-blocked on Vercel iad1.',
    },
    {
      id: 'z-ai',
      name: 'Z.ai (GLM-4)',
      envVar: 'ZAI_API_KEY (optional — config file based by default)',
      configured: !isVercel || !!process.env.ZAI_API_KEY,
      keyPreview: isVercel
        ? (process.env.ZAI_API_KEY ? mask(process.env.ZAI_API_KEY) : '(no env var, skipped on Vercel)')
        : '(loaded from ~/.zai/config.json)',
      model: 'glm-4.6',
      baseUrl: 'https://api.z.ai/api/paas/v4',
      inOrder: order.includes('z-ai'),
      willRun: order.includes('z-ai') && (!isVercel || !!process.env.ZAI_API_KEY),
      notes: 'Skipped on Vercel unless ZAI_API_KEY is set (UPGRADE #114).',
    },
    {
      id: 'brave',
      name: 'Brave AI (Brave Leo)',
      envVar: 'BRAVE_API_KEY',
      configured: !!process.env.BRAVE_API_KEY,
      keyPreview: mask(process.env.BRAVE_API_KEY),
      model: 'brave-leo-v1',
      baseUrl: 'https://api.search.brave.com/ai/v1/chat/completions',
      inOrder: order.includes('brave'),
      willRun: order.includes('brave') && !!process.env.BRAVE_API_KEY,
      notes: 'NEW in UPGRADE #113. Brave Search AI reseller. Works from any region.',
    },
    {
      id: 'cerebras',
      name: 'Cerebras (Llama 3.1 — fastest inference)',
      envVar: 'CEREBRAS_API_KEY',
      configured: !!process.env.CEREBRAS_API_KEY,
      keyPreview: mask(process.env.CEREBRAS_API_KEY),
      model: process.env.CEREBRAS_MODEL || 'llama3.1-8b',
      baseUrl: 'https://api.cerebras.ai/v1/chat/completions',
      inOrder: order.includes('cerebras'),
      willRun: order.includes('cerebras') && !!process.env.CEREBRAS_API_KEY,
      notes: 'NEW in UPGRADE #123. Ultra-fast inference (2600 tok/s).',
    },
  ]

  const activeChain = providers.filter((p) => p.willRun).map((p) => p.id)
  const skipped = providers.filter((p) => !p.willRun).map((p) => p.id)

  return Response.json({
    ok: true,
    timestamp: new Date().toISOString(),
    region: process.env.VERCEL_REGION || 'unknown',
    runtime: isVercel ? 'vercel-serverless' : 'local',
    llmProviderOrderEnv: process.env.LLM_PROVIDER_ORDER || '(not set, using default)',
    activeOrder: order,
    activeChain,
    skippedProviders: skipped,
    providers,
    summary: {
      totalProviders: providers.length,
      activeCount: activeChain.length,
      skippedCount: skipped.length,
      willAnythingWork: activeChain.length > 0,
    },
  })
}
