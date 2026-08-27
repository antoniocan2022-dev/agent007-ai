import { runCanonicalLlm } from './canonical-llm-router'

type Message = { role: 'system' | 'user' | 'assistant'; content: string }
type FunctionArgs = Record<string, unknown>

async function webSearch(query: string, num = 5): Promise<any[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Agent007-AI/3.0', Accept: 'text/html' },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`web_search failed: HTTP ${res.status}`)
  const html = await res.text()
  const out: any[] = []
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) && out.length < Math.min(Math.max(num, 1), 10)) {
    const clean = (x: string) => x.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim()
    out.push({ url: m[1], name: clean(m[2]), snippet: clean(m[3]) })
  }
  return out
}

export function getCanonicalLlmBridge(): any {
  const chat = {
    completions: {
      create: async (request: {
        messages: Message[]
        temperature?: number
        max_tokens?: number
        max_completion_tokens?: number
        thinking?: unknown
        stream?: boolean
        [key: string]: unknown
      }) => {
        const result: any = await runCanonicalLlm({
          messages: request.messages,
          taskType: 'reasoning',
          verification: 'standard',
          executionClass: 'standard',
          temperature: request.temperature,
          maxTokens: request.max_completion_tokens ?? request.max_tokens,
          timeoutMs: 30000,
          maxProviderAttempts: 5,
        })
        return {
          choices: [{ message: { role: 'assistant', content: result.content, reasoning_content: result.reasoningContent ?? '' }, finish_reason: 'stop' }],
          _provider: result.provider,
          _model: result.model,
          _attempts: result.attempts,
        }
      },
      createVision: async (request: any) => {
        const messages = Array.isArray(request?.messages) ? request.messages : []
        const normalized = messages.map((m: any) => ({
          role: m?.role === 'system' || m?.role === 'assistant' ? m.role : 'user',
          content: Array.isArray(m?.content) ? m.content.map((x: any) => x?.text || x?.image_url?.url || '').join('\n') : String(m?.content || ''),
        })) as Message[]
        const result: any = await runCanonicalLlm({ messages: normalized, taskType: 'analysis', verification: 'standard', executionClass: 'standard', timeoutMs: 30000, maxProviderAttempts: 5 })
        return { choices: [{ message: { role: 'assistant', content: result.content, reasoning_content: result.reasoningContent ?? '' } }] }
      },
    },
  }
  return {
    chat,
    functions: {
      invoke: async (name: string, args: FunctionArgs) => {
        if (name === 'web_search') return webSearch(String(args.query || ''), Number(args.num || 5))
        if (name === 'page_reader') {
          const target = String(args.url || '')
          const res = await fetch(target, { headers: { 'User-Agent': 'Agent007-AI/3.0' }, signal: AbortSignal.timeout(15000), redirect: 'follow' })
          if (!res.ok) throw new Error(`page_reader failed: HTTP ${res.status}`)
          const html = await res.text()
          const title = (html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || target).trim()
          return { data: { title, html } }
        }
        throw new Error(`Unsupported compatibility function: ${name}`)
      },
    },
    images: {
      generations: {
        create: async ({ prompt, size }: { prompt: string; size?: string }) => {
          const key = process.env.OPENAI_API_KEY
          if (!key) throw new Error('Image generation requires OPENAI_API_KEY')
          const res = await fetch('https://api.openai.com/v1/images/generations', {
            method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify({ model: 'gpt-image-1', prompt, size: size || '1024x1024', n: 1 }),
            signal: AbortSignal.timeout(60000),
          })
          if (!res.ok) throw new Error(`image generation failed: HTTP ${res.status}`)
          const data: any = await res.json()
          return { data: [{ base64: data?.data?.[0]?.b64_json || '' }] }
        },
      },
    },
  }
}
