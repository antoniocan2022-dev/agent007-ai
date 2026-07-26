/**
 * GET /api/health/llm-test — UPGRADE #157
 * Actually TESTS each LLM provider by sending a real API call.
 * Unlike /api/health/llm-providers (which only checks if the KEY EXISTS),
 * this endpoint sends a real "say hi" message to each provider and reports
 * whether the call SUCCEEDED or FAILED, with the exact error.
 *
 * This is the diagnostic tool to use when the agent "is not responding."
 * If all providers fail here, the keys are invalid/expired and need to be
 * updated in Vercel env vars.
 */
import { NextResponse } from 'next/server'
import { callLlmWithRetry } from '@/lib/agent'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET() {
  const results: Array<{
    provider: string
    status: 'pass' | 'fail'
    detail: string
    responseTimeMs: number
  }> = []

  // Test each provider individually
  const providers: Array<{ name: string; envVar: string; test: () => Promise<string> }> = [
    {
      name: 'Mistral',
      envVar: 'MISTRAL_API_KEY',
      test: async () => {
        const key = process.env.MISTRAL_API_KEY!
        const start = Date.now()
        const resp = await fetch('https://api.mistral.ai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
          body: JSON.stringify({ model: 'mistral-small-latest', messages: [{ role: 'user', content: 'say hi' }], max_tokens: 5 }),
          signal: AbortSignal.timeout(15000),
        })
        const ms = Date.now() - start
        if (!resp.ok) {
          const text = await resp.text().catch(() => '')
          throw new Error(`HTTP ${resp.status} (${ms}ms) — ${text.slice(0, 100)}`)
        }
        const data = await resp.json()
        const content = data?.choices?.[0]?.message?.content ?? ''
        return `OK (${ms}ms) — response: "${content.slice(0, 30)}"`
      },
    },
    {
      name: 'Groq',
      envVar: 'GROQ_API_KEY',
      test: async () => {
        const key = process.env.GROQ_API_KEY!
        const start = Date.now()
        const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
          body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: 'say hi' }], max_tokens: 5 }),
          signal: AbortSignal.timeout(15000),
        })
        const ms = Date.now() - start
        if (!resp.ok) {
          const text = await resp.text().catch(() => '')
          throw new Error(`HTTP ${resp.status} (${ms}ms) — ${text.slice(0, 100)}`)
        }
        const data = await resp.json()
        const content = data?.choices?.[0]?.message?.content ?? ''
        return `OK (${ms}ms) — response: "${content.slice(0, 30)}"`
      },
    },
    {
      name: 'OpenRouter',
      envVar: 'OPENROUTER_API_KEY',
      test: async () => {
        const key = process.env.OPENROUTER_API_KEY!
        const start = Date.now()
        const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}`, 'HTTP-Referer': 'https://agent007-ai.vercel.app', 'X-Title': 'Agent007 AI' },
          body: JSON.stringify({ model: 'meta-llama/llama-3.3-70b-instruct:free', messages: [{ role: 'user', content: 'say hi' }], max_tokens: 5 }),
          signal: AbortSignal.timeout(15000),
        })
        const ms = Date.now() - start
        if (!resp.ok) {
          const text = await resp.text().catch(() => '')
          throw new Error(`HTTP ${resp.status} (${ms}ms) — ${text.slice(0, 100)}`)
        }
        const data = await resp.json()
        const content = data?.choices?.[0]?.message?.content ?? ''
        return `OK (${ms}ms) — response: "${content.slice(0, 30)}"`
      },
    },
    {
      name: 'Cerebras',
      envVar: 'CEREBRAS_API_KEY',
      test: async () => {
        const key = process.env.CEREBRAS_API_KEY!
        const start = Date.now()
        const resp = await fetch('https://api.cerebras.ai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
          body: JSON.stringify({ model: 'llama3.1-8b', messages: [{ role: 'user', content: 'say hi' }], max_tokens: 5 }),
          signal: AbortSignal.timeout(15000),
        })
        const ms = Date.now() - start
        if (!resp.ok) {
          const text = await resp.text().catch(() => '')
          throw new Error(`HTTP ${resp.status} (${ms}ms) — ${text.slice(0, 100)}`)
        }
        const data = await resp.json()
        const content = data?.choices?.[0]?.message?.content ?? ''
        return `OK (${ms}ms) — response: "${content.slice(0, 30)}"`
      },
    },
    {
      name: 'Gemini',
      envVar: 'GEMINI_API_KEY',
      test: async () => {
        const key = process.env.GEMINI_API_KEY!
        const start = Date.now()
        const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: 'say hi' }] }] }),
          signal: AbortSignal.timeout(15000),
        })
        const ms = Date.now() - start
        if (!resp.ok) {
          const text = await resp.text().catch(() => '')
          throw new Error(`HTTP ${resp.status} (${ms}ms) — ${text.slice(0, 100)}`)
        }
        const data = await resp.json()
        const content = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
        return `OK (${ms}ms) — response: "${content.slice(0, 30)}"`
      },
    },
    {
      name: 'OpenAI',
      envVar: 'OPENAI_API_KEY',
      test: async () => {
        const key = process.env.OPENAI_API_KEY!
        const start = Date.now()
        const resp = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
          body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'say hi' }], max_tokens: 5 }),
          signal: AbortSignal.timeout(15000),
        })
        const ms = Date.now() - start
        if (!resp.ok) {
          const text = await resp.text().catch(() => '')
          throw new Error(`HTTP ${resp.status} (${ms}ms) — ${text.slice(0, 100)}`)
        }
        const data = await resp.json()
        const content = data?.choices?.[0]?.message?.content ?? ''
        return `OK (${ms}ms) — response: "${content.slice(0, 30)}"`
      },
    },
  ]

  // Test each provider in parallel
  const testPromises = providers.map(async (p) => {
    const start = Date.now()
    if (!process.env[p.envVar]) {
      return {
        provider: p.name,
        status: 'fail' as const,
        detail: `${p.envVar} not set`,
        responseTimeMs: 0,
      }
    }
    try {
      const detail = await p.test()
      return {
        provider: p.name,
        status: 'pass' as const,
        detail,
        responseTimeMs: Date.now() - start,
      }
    } catch (e: any) {
      return {
        provider: p.name,
        status: 'fail' as const,
        detail: e?.message?.slice(0, 200) ?? 'unknown error',
        responseTimeMs: Date.now() - start,
      }
    }
  })

  const testResults = await Promise.all(testPromises)
  results.push(...testResults)

  const passCount = results.filter(r => r.status === 'pass').length
  const failCount = results.filter(r => r.status === 'fail').length

  return NextResponse.json({
    ok: passCount > 0,
    timestamp: new Date().toISOString(),
    summary: `${passCount}/${results.length} providers working`,
    allFailed: passCount === 0,
    results,
    recommendation: passCount === 0
      ? 'ALL LLM PROVIDERS FAILED. The API keys are invalid, expired, or revoked. Go to Vercel → Settings → Environment Variables and update ALL LLM keys. Then redeploy.'
      : passCount < 3
        ? `Only ${passCount} provider(s) working. Update the failed providers' API keys for better reliability.`
        : `${passCount} providers working — agent should respond normally.`,
  })
}
