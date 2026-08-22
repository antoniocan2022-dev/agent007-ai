import type { TaskType, VerificationTier } from './subagent-governance'

const HF_BASE_URL = 'https://router.huggingface.co/v1/chat/completions'
const HF_TOKEN_ENV = 'HF_TOKEN'
const DEFAULT_HF_MODEL = 'openai/gpt-oss-120b:fastest'
const DEFAULT_TIMEOUT_MS = 15000
const DEFAULT_MAX_TOKENS = 512

export interface HuggingFaceRequest {
  messages: readonly Record<string, unknown>[]
  model?: string
  taskType?: TaskType
  verification?: VerificationTier
  temperature?: number
  maxTokens?: number
  timeoutMs?: number
}

export interface HuggingFaceResult {
  provider: 'huggingface'
  model: string
  routingPolicy: 'fastest' | 'cheapest' | 'preferred' | 'specific'
  content: string
  responseMs: number
}

export interface HuggingFaceProbeResult {
  configured: boolean
  success: boolean
  model: string | null
  responseMs: number | null
  error?: string
}

function readEnv(name: string): string | undefined {
  const value = process.env[name]
  return value && value.trim() ? value.trim() : undefined
}

export function isHuggingFaceConfigured(): boolean {
  return Boolean(readEnv(HF_TOKEN_ENV))
}

export function getHuggingFaceModel(): string {
  return readEnv('HF_MODEL') ?? DEFAULT_HF_MODEL
}

function classifyRoutingPolicy(model: string): HuggingFaceResult['routingPolicy'] {
  if (model.endsWith(':fastest')) return 'fastest'
  if (model.endsWith(':cheapest')) return 'cheapest'
  if (model.endsWith(':preferred')) return 'preferred'
  return model.includes(':') ? 'specific' : 'fastest'
}

function extractContent(data: any): string {
  const content = data?.choices?.[0]?.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((part: any) => typeof part?.text === 'string' ? part.text : '').join('')
  return ''
}

export async function runHuggingFaceChat(request: HuggingFaceRequest): Promise<HuggingFaceResult> {
  const token = readEnv(HF_TOKEN_ENV)
  if (!token) throw new Error(`${HF_TOKEN_ENV} is not configured`)

  const model = request.model?.trim() || getHuggingFaceModel()
  const timeoutMs = Math.max(1000, request.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const started = Date.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(HF_BASE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: request.messages,
        temperature: request.temperature ?? 0.2,
        max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      }),
      signal: controller.signal,
    })

    const responseMs = Date.now() - started
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500)
      const error = new Error(`Hugging Face: HTTP ${response.status}${detail ? ` — ${detail}` : ''}`)
      ;(error as any).status = response.status
      throw error
    }

    const content = extractContent(await response.json())
    if (!content) throw new Error('Hugging Face: response contained no assistant content')

    return {
      provider: 'huggingface',
      model,
      routingPolicy: classifyRoutingPolicy(model),
      content,
      responseMs,
    }
  } finally {
    clearTimeout(timeout)
  }
}

export async function probeHuggingFace(): Promise<HuggingFaceProbeResult> {
  if (!isHuggingFaceConfigured()) {
    return {
      configured: false,
      success: false,
      model: null,
      responseMs: null,
      error: `${HF_TOKEN_ENV} is not configured`,
    }
  }

  try {
    const result = await runHuggingFaceChat({
      model: getHuggingFaceModel(),
      messages: [
        { role: 'system', content: 'You are a production health probe. Reply with exactly: OK' },
        { role: 'user', content: 'Say OK' },
      ],
      taskType: 'operations',
      verification: 'standard',
      temperature: 0,
      maxTokens: 128,
      timeoutMs: 12000,
    })

    const normalized = result.content.trim().toUpperCase()
    return {
      configured: true,
      success: normalized.includes('OK'),
      model: result.model,
      responseMs: result.responseMs,
      error: normalized.includes('OK') ? undefined : `Unexpected probe response: ${result.content.slice(0, 120)}`,
    }
  } catch (error) {
    return {
      configured: true,
      success: false,
      model: getHuggingFaceModel(),
      responseMs: null,
      error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
    }
  }
}
