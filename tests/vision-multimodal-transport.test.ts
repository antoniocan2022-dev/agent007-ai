import { describe, expect, test, afterEach } from 'bun:test'
import { getCanonicalLlmBridge } from '@/lib/canonical-provider-bridge'
import { getVisionCapableModel } from '@/lib/provider-control-plane'
import { clearProviderCatalogCache } from '@/lib/provider-control-plane'
import { resetProviderHealthForTests } from '@/lib/provider-intelligence'
import { resetProviderStandingForTests } from '@/lib/provider-standing'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  clearProviderCatalogCache()
  resetProviderHealthForTests()
  resetProviderStandingForTests()
  for (const key of ['CLOUDFLARE_API_KEY', 'CLOUDFLARE_ACCOUNT_ID']) delete process.env[key]
})

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('Vision multimodal transport (production incident 2026-09-28)', () => {
  test('getVisionCapableModel returns a real governed provider/model pair declared vision-capable', () => {
    const result = getVisionCapableModel()
    expect(result).toBeDefined()
    expect(result!.provider).toBe('cloudflare')
    expect(result!.model).toBe('@cf/google/gemma-4-26b-a4b-it')
  })

  // Root cause reproduction: canonical-provider-bridge.ts's createVision() used to flatten
  // [{ type: 'text', text }, { type: 'image_url', image_url: { url } }] into a bare string via
  // `x?.text || x?.image_url?.url || ''`, embedding the entire data URI as literal text and sending it
  // to a text-only completion endpoint -- no image content ever reached any provider. This test proves
  // the real HTTP request body sent to the provider now carries the structured multimodal content
  // array, not a flattened string.
  test('createVision sends the real structured image_url content in the outgoing provider request, not a flattened string', async () => {
    process.env.CLOUDFLARE_API_KEY = 'test-cloudflare'
    process.env.CLOUDFLARE_ACCOUNT_ID = 'test-account'
    const imageDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
    let capturedBody: any = null
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/ai/models/search')) return jsonResponse({ result: [{ name: '@cf/google/gemma-4-26b-a4b-it' }] })
      if (url.includes('/ai/v1/chat/completions')) {
        capturedBody = JSON.parse(String(init?.body))
        return jsonResponse({ choices: [{ message: { role: 'assistant', content: 'A red square on a white background.' } }] })
      }
      throw new Error(`Unexpected fetch to ${url}`)
    }) as typeof fetch

    const bridge = getCanonicalLlmBridge()
    const response: any = await bridge.chat.completions.createVision({
      model: 'glm-4.5v',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What is in this image?' },
            { type: 'image_url', image_url: { url: imageDataUrl } },
          ],
        },
      ],
    })

    expect(capturedBody).not.toBeNull()
    const sentMessage = capturedBody.messages.find((m: any) => m.role === 'user')
    expect(Array.isArray(sentMessage.content)).toBe(true)
    const textPart = sentMessage.content.find((part: any) => part.type === 'text')
    const imagePart = sentMessage.content.find((part: any) => part.type === 'image_url')
    expect(textPart?.text).toBe('What is in this image?')
    expect(imagePart?.image_url?.url).toBe(imageDataUrl)
    // The old bug: the entire content was collapsed into ONE string containing both the prompt text
    // and the raw data URI concatenated together. Confirm that never happens.
    expect(typeof sentMessage.content).not.toBe('string')
    // Confirms the request was pinned to the governed vision-capable model, not routed generically.
    expect(capturedBody.model).toBe('@cf/google/gemma-4-26b-a4b-it')
    expect(response.choices[0].message.content).toBe('A red square on a white background.')
  })
})
