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

  // Determine which provider will be used
  if (process.env.OPENAI_API_KEY) {
    diagnosis.provider = 'OpenAI (fast path — OPENAI_API_KEY is set)'
    diagnosis.instructions = 'Agent007 will use OpenAI directly. If the key is invalid/expired, you will get auth errors.'
  } else {
    diagnosis.provider = 'Z.ai SDK (primary) → OpenAI (fallback)'
    diagnosis.instructions = 'Agent007 will try Z.ai first. If Z.ai fails, it falls back to OpenAI (if key is set in DB or env).'
  }

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
      provider: result?._provider ?? (process.env.OPENAI_API_KEY ? 'openai' : 'z-ai'),
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
