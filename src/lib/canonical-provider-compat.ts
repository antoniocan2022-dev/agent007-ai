import { canonicalWebSearch } from './canonical-web-search'
import { callLlmWithRetry } from './agent-canonical-bridge'

export async function getCanonicalCompatClient() {
  return {
    chat: {
      completions: {
        create: async (params: any) => callLlmWithRetry(params?.messages ?? [], {
          temperature: params?.temperature,
          maxTokens: params?.max_tokens,
        }),
      },
    },
    functions: {
      invoke: async (name: string, args: any) => {
        switch (name) {
          case 'web_search':
            return canonicalWebSearch(String(args?.query ?? ''), Number(args?.num ?? 5), Number(args?.recency_days ?? 0) || undefined)
          case 'page_reader': {
            const url = String(args?.url ?? '')
            const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Agent007-AI/2.0' }, signal: AbortSignal.timeout(15000) })
            if (!res.ok) throw new Error(`Page fetch failed: HTTP ${res.status}`)
            const html = await res.text()
            const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
            return { data: { html, title: url, text: text.slice(0, 12000) } }
          }
          case 'vision': {
            const response = await callLlmWithRetry([{ role: 'user', content: `${String(args?.prompt ?? 'Describe this image in detail.')}\n${String(args?.image_url ?? args?.data_url ?? '')}` }], { taskType: 'analysis', verification: 'standard' })
            return { choices: [{ message: { content: response?.content ?? '' } }] }
          }
          case 'image_gen': {
            const apiKey = process.env.OPENAI_API_KEY
            if (!apiKey) throw new Error('Image generation requires OPENAI_API_KEY')
            const response = await fetch('https://api.openai.com/v1/images/generations', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'gpt-image-1', prompt: String(args?.prompt ?? ''), size: String(args?.size ?? '1024x1024') }), signal: AbortSignal.timeout(30000) })
            if (!response.ok) throw new Error(`Image generation failed: HTTP ${response.status}`)
            const json: any = await response.json()
            const b64 = json?.data?.[0]?.b64_json ?? json?.data?.[0]?.base64
            if (!b64) throw new Error('Image generation returned no image data')
            return { data: [{ base64: b64 }] }
          }
          default:
            throw new Error(`Unsupported canonical function: ${name}`)
        }
      },
    },
  }
}
