import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { getHuggingFaceModel, isHuggingFaceConfigured, probeHuggingFace, runHuggingFaceChat } from '../src/lib/huggingface-runtime'

describe('Hugging Face governed runtime', () => {
  beforeEach(() => {
    delete process.env.HF_TOKEN
    delete process.env.HF_MODEL
  })

  it('fails closed when HF_TOKEN is missing', async () => {
    expect(isHuggingFaceConfigured()).toBe(false)
    const probe = await probeHuggingFace()
    expect(probe.success).toBe(false)
    expect(probe.configured).toBe(false)
    expect(probe.error).toContain('HF_TOKEN')
  })

  it('uses the documented safe default model and allows an explicit model override', () => {
    expect(getHuggingFaceModel()).toBe('openai/gpt-oss-120b:fastest')
    process.env.HF_MODEL = 'Qwen/Qwen3-32B:groq'
    expect(getHuggingFaceModel()).toBe('Qwen/Qwen3-32B:groq')
  })

  it('does not expose the token in request payloads', async () => {
    process.env.HF_TOKEN = 'test-hf-token'
    process.env.HF_MODEL = 'openai/gpt-oss-120b:fastest'
    const originalFetch = globalThis.fetch
    let capturedBody = ''
    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = String(init?.body ?? '')
      return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof fetch

    try {
      const result = await runHuggingFaceChat({ messages: [{ role: 'user', content: 'Say OK' }] })
      expect(result.content).toBe('OK')
      expect(capturedBody).not.toContain('test-hf-token')
      expect(result.provider).toBe('huggingface')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('accepts a valid probe response with a normal text completion', async () => {
    process.env.HF_TOKEN = 'test-hf-token'
    const originalFetch = globalThis.fetch
    globalThis.fetch = mock(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch

    try {
      const probe = await probeHuggingFace()
      expect(probe.configured).toBe(true)
      expect(probe.success).toBe(true)
      expect(probe.model).toBe('openai/gpt-oss-120b:fastest')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
