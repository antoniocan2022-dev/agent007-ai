/**
 * Fallback LLM provider.
 *
 * Checks TWO sources for the OpenAI API key:
 * 1. process.env.OPENAI_API_KEY (set in .env or Vercel env vars)
 * 2. Database ApiKey table (set via Settings → API Keys UI)
 *
 * This way, users can add their key via the UI without needing to
 * modify env vars or redeploy.
 */

export interface FallbackMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

// Performance/accuracy tuning (upgrade #31):
//   - gpt-4o-mini: fast + cheap, good for routine tool routing
//   - gpt-4o: higher accuracy for complex multi-tool orchestration
// Owner can override via OPENAI_MODEL env var.
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o'
const OPENAI_BASE_URL =
  process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1/chat/completions'

// In-memory cache for the DB-stored API key (avoids querying DB on every call)
let _cachedDbKey: string | null | undefined = undefined
let _cachedDbKeyAt: number = 0
const CACHE_TTL_MS = 60 * 1000 // 1 minute

/**
 * Get the OpenAI API key from env or DB or /tmp file.
 */
async function getOpenAIKey(): Promise<string | null> {
  // 1. Check env var first (fastest — set in Vercel env vars)
  if (process.env.OPENAI_API_KEY) {
    return process.env.OPENAI_API_KEY
  }

  // 2. Check DB cache (if cached and fresh)
  if (_cachedDbKey !== undefined && Date.now() - _cachedDbKeyAt < CACHE_TTL_MS) {
    return _cachedDbKey
  }

  // 3. Check /tmp file (persists across Vercel cold starts within reuse window)
  try {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const os = await import('node:os')
    const apiKeysFile = path.join(os.tmpdir(), 'agent007-api-keys.json')
    if (fs.existsSync(apiKeysFile)) {
      const raw = fs.readFileSync(apiKeysFile, 'utf-8')
      const keys = JSON.parse(raw) as Array<any>
      const openaiKey = keys.find(k => k.service === 'openai')
      if (openaiKey?.key) {
        _cachedDbKey = openaiKey.key
        _cachedDbKeyAt = Date.now()
        return openaiKey.key
      }
    }
  } catch {}

  // 4. Query DB for the key
  try {
    const { db } = await import('./db')
    const { ensureDbReady } = await import('./db')
    await ensureDbReady().catch(() => {})

    const dbKey = await db.apiKey.findFirst({
      where: { service: 'openai' },
      orderBy: { createdAt: 'desc' },
    }).catch(() => null)

    if (dbKey?.key) {
      // De-obfuscate (stored as base64 of key + salt)
      try {
        const OBF_SALT = 'agent007-obf-salt-2024'
        const decoded = Buffer.from(dbKey.key, 'base64').toString('utf-8')
        const realKey = decoded.replace(OBF_SALT, '')
        _cachedDbKey = realKey
        _cachedDbKeyAt = Date.now()
        return realKey
      } catch {
        // Maybe it's stored as plain text
        _cachedDbKey = dbKey.key
        _cachedDbKeyAt = Date.now()
        return dbKey.key
      }
    }
  } catch (e: any) {
    console.error('[llm-fallback] DB key lookup failed:', e?.message)
  }

  _cachedDbKey = null
  _cachedDbKeyAt = Date.now()
  return null
}

/**
 * Call the fallback LLM. Returns an object shaped like the Z.ai SDK's
 * chat completion response so callLlmWithRetry's caller can treat both
 * providers uniformly.
 */
export async function callFallbackLlm(messages: FallbackMessage[]): Promise<any> {
  const apiKey = await getOpenAIKey()

  if (!apiKey) {
    throw new Error(
      'No LLM configured. The primary provider (z-ai) is not available on this server, and no OpenAI API key was found.\n\n' +
      'To fix this:\n' +
      '1. Go to Settings → API Key Manager\n' +
      '2. Add a key with service "openai" and your OpenAI API key (sk-...)\n' +
      '3. Try chatting again\n\n' +
      'Or set OPENAI_API_KEY as a Vercel environment variable.'
    )
  }

  // UPGRADE #117 — Smart Response Parameters:
  //   - temperature 0.7 (was 0.3): allows creative, nuanced, varied responses.
  //     0.3 was making the agent sound flat and robotic. 0.7 is what Claude/GLM use.
  //   - max_tokens 12000 (was 8000): allows longer, deeper responses (1500-2000 words)
  //   - presence_penalty 0.4 (was 0.2): reduces repetition, encourages covering new ground
  //   - top_p 0.95: kept (good balance)
  const body = {
    model: OPENAI_MODEL,
    messages,
    temperature: 0.7,
    max_tokens: 12000,
    top_p: 0.95,
    presence_penalty: 0.4,
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
      `Fallback LLM (OpenAI) failed: HTTP ${resp.status} — ${text.slice(0, 300)}`
    )
  }

  const data = await resp.json().catch(() => null)
  const content: string =
    data?.choices?.[0]?.message?.content ??
    data?.choices?.[0]?.text ??
    ''

  if (!content) {
    throw new Error('Fallback LLM (OpenAI) returned empty content')
  }

  // Pass through finish_reason so the orchestrator can detect length-truncation
  // and automatically retry with a larger max_tokens budget (upgrade #31).
  const finishReason: string = data?.choices?.[0]?.finish_reason ?? 'stop'

  // UPGRADE #119 — Extract reasoning if present
  // (OpenAI o1/o3 models return reasoning_content; gpt-4o doesn't, but we check anyway)
  const reasoning: string | null =
    data?.choices?.[0]?.message?.reasoning ||
    data?.choices?.[0]?.message?.reasoning_content ||
    null

  return {
    choices: [
      {
        message: { content, reasoning },
        finish_reason: finishReason,
      },
    ],
    _provider: 'openai-fallback',
    _reasoning: reasoning,
  }
}

/** True when a fallback provider is configured (key present in env or DB). */
export function isFallbackConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY
}

/** Clear the DB key cache (call after adding/updating API keys). */
export function clearKeyCache() {
  _cachedDbKey = undefined
  _cachedDbKeyAt = 0
}
