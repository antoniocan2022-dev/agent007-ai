/**
 * Fallback LLM provider stub.
 *
 * If `OPENAI_API_KEY` is set in the environment, we attempt to call the
 * OpenAI Chat Completions API directly via fetch (no SDK install needed).
 * This is a minimal, dependency-free implementation — it does NOT support
 * streaming, function calling, or vision. It is intentionally simple so the
 * system can limp along when the primary Z.ai provider is rate-limited.
 *
 * If no `OPENAI_API_KEY` is set, `callFallbackLlm()` throws a clear error
 * explaining how to enable it. The caller (callLlmWithRetry) catches that
 * and re-throws the ORIGINAL error so friendlyLlmError() can produce a
 * sensible message.
 *
 * Server-only. Never import from a client component.
 */

export interface FallbackMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini'
const OPENAI_BASE_URL =
  process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1/chat/completions'

/**
 * Call the fallback LLM. Returns an object shaped like the Z.ai SDK's
 * chat completion response so callLlmWithRetry's caller can treat both
 * providers uniformly: `{ choices: [{ message: { content: '...' } }] }`.
 *
 * Throws if OPENAI_API_KEY is not set, or if the fetch fails / returns
 * a non-OK response.
 */
export async function callFallbackLlm(messages: FallbackMessage[]): Promise<any> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error(
      'No fallback LLM configured. Set OPENAI_API_KEY env var to enable.'
    )
  }

  const body = {
    model: OPENAI_MODEL,
    messages,
    temperature: 0.6,
  }

  const resp = await fetch(OPENAI_BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(
      `Fallback LLM (OpenAI) failed: HTTP ${resp.status} — ${text.slice(0, 200)}`
    )
  }

  const data = await resp.json().catch(() => null)
  // Normalize to the shape the rest of the agent code expects.
  const content: string =
    data?.choices?.[0]?.message?.content ??
    data?.choices?.[0]?.text ??
    ''
  return {
    choices: [
      {
        message: { content },
      },
    ],
    _provider: 'openai-fallback',
  }
}

/** True when a fallback provider is configured (key present). */
export function isFallbackConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY
}
