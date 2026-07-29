import { NextResponse } from 'next/server'
import { callLlmWithRetry, friendlyLlmError } from '@/lib/agent'
import { isFallbackConfigured } from '@/lib/llm-fallback'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/system/diagnose-llm
 *
 * Diagnoses which AI provider Agent007 is using and tests if it works.
 * Returns:
 * - Which provider is active (z-ai or OpenAI)
 * - Whether the API key is set (env or DB)
 * - Whether a test LLM call succeeds
 * - The specific error if it fails
 */

export async function GET() {
  const diagnosis: any = {
    timestamp: new Date().toISOString(),
    env: {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ? `SET (${process.env.OPENAI_API_KEY.slice(0, 7)}...)` : 'NOT SET',
      OPENAI_MODEL: process.env.OPENAI_MODEL || 'gpt-4o-mini (default)',
      OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1 (default)',
      ZAI_API_KEY: process.env.ZAI_API_KEY ? 'SET' : 'NOT SET',
    },
    fallbackConfigured: isFallbackConfigured(),
    provider: 'unknown',
    testResult: null,
    error: null,
  }

  // UPGRADE #170 fix #7: BEFORE — this endpoint hardcoded the chain text as
  // "Mistral → Groq → OpenRouter → Cerebras → Brave AI → Gemini" and claimed
  // "OpenAI + z.ai are disabled per owner request". That text was wrong:
  //   - The actual DEFAULT_ORDER (agent.ts:307) is ['groq', 'openai', 'z-ai', 'mistral']
  //   - OpenAI is NOT disabled (env var OPENAI_API_KEY is set on production)
  //   - z.ai is NOT disabled (env var ZAI_API_KEY is set)
  //   - Mistral was listed first when actually it's the LAST resort
  // The misleading text was visible to any user visiting /api/system/diagnose-llm.
  // AFTER — we dynamically build the chain text from the actual env vars +
  // DEFAULT_ORDER. Display matches reality.
  const DEFAULT_ORDER = ['groq', 'openai', 'z-ai', 'mistral']
  const providerHasEnv: Record<string, boolean> = {
    groq: !!process.env.GROQ_API_KEY,
    openai: !!process.env.OPENAI_API_KEY,
    'z-ai': !!(process.env.ZAI_API_KEY || process.env.ZAI_API_TOKEN),
    mistral: !!process.env.MISTRAL_API_KEY,
  }
  // Also check the deprecated/extra providers for backward visibility
  const extraProviders: string[] = []
  if (process.env.OPENROUTER_API_KEY) extraProviders.push('OpenRouter')
  if (process.env.CEREBRAS_API_KEY) extraProviders.push('Cerebras')
  if (process.env.BRAVE_API_KEY) extraProviders.push('Brave AI')
  if (process.env.GEMINI_API_KEY) extraProviders.push('Gemini')

  // Build the active chain sorted by DEFAULT_ORDER (Groq → OpenAI → z.ai → Mistral)
  const activeOrdered = DEFAULT_ORDER
    .filter((p) => providerHasEnv[p])
    .map((p) => p === 'z-ai' ? 'z.ai' : p.charAt(0).toUpperCase() + p.slice(1))

  const allConfigured = [...activeOrdered, ...extraProviders]

  diagnosis.provider = allConfigured.length > 0
    ? `Active chain (priority order): ${activeOrdered.join(' → ')}` +
      (extraProviders.length > 0 ? ` | Also configured but lower priority: ${extraProviders.join(', ')}` : '')
    : 'No providers configured'
  diagnosis.instructions = allConfigured.length > 0
    ? `Agent007 tries providers in this order: ${activeOrdered.join(' → ')}. (Fallback chain: ${extraProviders.join(', ') || 'none'}.)`
    : 'Set at least one LLM API key in Vercel env vars (GROQ_API_KEY, OPENAI_API_KEY, ZAI_API_KEY, or MISTRAL_API_KEY).'

  // Test the LLM call
  try {
    const result = await callLlmWithRetry([
      { role: 'system', content: 'You are a test assistant. Reply with exactly: OK' },
      { role: 'user', content: 'Say OK' },
    ])

    const content = result?.choices?.[0]?.message?.content ?? ''
    const model = result?.model ?? 'unknown'

    diagnosis.testResult = {
      success: true,
      model,
      response: content.slice(0, 100),
      provider: result?._provider ?? allConfigured[0] ?? 'unknown',
    }
    diagnosis.overallStatus = '✅ WORKING'
    diagnosis.message = `AI provider is working. Model: ${model}. Test response: "${content.slice(0, 50)}"`
  } catch (e: any) {
    const rawError = e?.message ?? String(e)
    const status = e?.status ?? e?.response?.status

    diagnosis.testResult = {
      success: false,
      rawError: rawError.slice(0, 300),
      status,
    }
    diagnosis.error = friendlyLlmError(e)
    diagnosis.overallStatus = '❌ FAILED'
    diagnosis.message = `AI provider test failed: ${diagnosis.error.slice(0, 200)}`

    // Detect region block specifically
    const lower = rawError.toLowerCase()
    if (lower.includes('unsupported_country_region_territory') || lower.includes('region') && lower.includes('not supported')) {
      diagnosis.regionBlocked = true
      diagnosis.fix = {
        provider: 'OpenAI',
        issue: 'Region blocked (unsupported_country_region_territory)',
        steps: [
          '🔑 The API key is VALID — no need to change it',
          '🌍 OpenAI blocks requests from this server region',
          '1. Deploy to Vercel (US servers) — OpenAI works there',
          '2. Agent007 uses Z.ai SDK as primary in dev (works fine)',
          '3. The key will work when deployed to a supported region',
        ],
      }
    } else if (lower.includes('openai') || lower.includes('fallback') || process.env.OPENAI_API_KEY) {
      diagnosis.fix = {
        provider: 'OpenAI',
        steps: [
          '1. Check your OpenAI API key at https://platform.openai.com/api-keys',
          '2. Ensure you have credits at https://platform.openai.com/account/billing',
          '3. Update the key in Settings → API Key Manager',
          '4. Or set OPENAI_API_KEY as a Vercel env var at https://vercel.com/dashboard',
        ],
      }
    } else {
      diagnosis.fix = {
        provider: 'Z.ai',
        steps: [
          '1. Z.ai SDK may have a temporary auth issue — retry in a few minutes',
          '2. Add an OPENAI_API_KEY as fallback in Settings → API Key Manager',
          '3. Or set OPENAI_API_KEY as a Vercel env var',
        ],
      }
    }
  }

  return NextResponse.json(diagnosis)
}
