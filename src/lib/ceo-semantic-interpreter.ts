import { runCanonicalLlm } from './canonical-llm-router'
import type { CanonicalConversationContext, CognitiveDepth, SemanticIntentHint, SemanticInterpretation, SemanticSpeechAct } from './ceo-cognitive-conversation'
import { isCeoRequestAborted } from './ceo-cancellation'

const TYPO_HINT_RE = /\b(?:wht|whay|taht|teh|contnue|plese|pleas|realy|becase|dontt|cantt|isntt|explainn|agian|recieve|seperate|improt|prioritze|prority)\b/i
const AMBIGUITY_HINT_RE = /\b(?:it|they|them|this|that|these|those|same|earlier|before|previous|continue|first|second|third|last|other)\b/i

const ALLOWED_INTENTS = new Set<SemanticIntentHint>(['conversation', 'analysis', 'decision', 'research', 'action', 'unknown'])
const ALLOWED_SPEECH_ACTS = new Set<SemanticSpeechAct>(['social', 'question', 'proposition', 'continuation', 'correction', 'request', 'unknown'])
const ALLOWED_DEPTHS = new Set<CognitiveDepth>(['direct', 'contextual', 'deep', 'strategic'])

function shouldAssist(context: CanonicalConversationContext): boolean {
  return Boolean(context.references.some((reference) => reference.ambiguous || reference.confidence < 0.7) || TYPO_HINT_RE.test(context.currentMessage) || AMBIGUITY_HINT_RE.test(context.currentMessage))
}

function parseJsonObject(content: string): Record<string, unknown> | null {
  const trimmed = content.trim()
  const candidates = [trimmed, trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()]
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
    } catch {}
  }
  return null
}

function boundedMeaning(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.replace(/\s+/g, ' ').trim().slice(0, 1200)
  return text || undefined
}
function boundedConfidence(value: unknown): number | undefined {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : undefined
}
function parseUncertainty(value: unknown): SemanticInterpretation['uncertainty'] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 6).flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    const code = typeof record.code === 'string' ? record.code.replace(/[^a-z0-9_:-]/gi, '').slice(0, 64) : ''
    const description = typeof record.description === 'string' ? record.description.replace(/\s+/g, ' ').trim().slice(0, 240) : ''
    const severity = record.severity === 'low' || record.severity === 'medium' || record.severity === 'high' ? record.severity : 'medium'
    return code && description ? [{ code, description, severity }] : []
  })
}

export async function interpretCeoSemantics(context: CanonicalConversationContext, signal?: AbortSignal): Promise<Partial<SemanticInterpretation>> {
  if (!shouldAssist(context)) return { source: 'deterministic' }
  try {
    const result = await runCanonicalLlm({
      messages: [
        {
          role: 'system',
          content: [
            'You are Agent007 semantic interpreter. Interpret the user message using the supplied conversation context.',
            'Correct obvious spelling/typing noise silently. Resolve intended meaning from context without inventing facts.',
            'Return ONLY valid JSON with keys: meaning, confidence, intent, speechAct, cognitiveDepth, uncertainty.',
            'confidence must be a number from 0 to 1.',
            'uncertainty must be an array of {code,description,severity}, severity low|medium|high.',
            'Allowed intent: conversation, analysis, decision, research, action, unknown.',
            'Allowed speechAct: social, question, proposition, continuation, correction, request, unknown.',
            'Allowed cognitiveDepth: direct, contextual, deep, strategic.',
          ].join(' '),
        },
        {
          role: 'user',
          content: `CURRENT MESSAGE:\n${context.currentMessage.slice(0, 4000)}\n\nWORKING TOPIC:\n${context.worldModel.workingTopic || 'unknown'}\n\nRECENT GOALS:\n${context.worldModel.userGoals.join(' | ') || 'none'}\n\nDECISIONS:\n${context.worldModel.decisions.join(' | ') || 'none'}\n\nOPEN LOOPS:\n${context.worldModel.openLoops.join(' | ') || 'none'}\n\nREFERENCES:\n${context.references.map((reference) => `${reference.phrase} -> ${reference.resolvedText ?? 'unresolved'}`).join(' | ') || 'none'}`,
        },
      ],
      taskType: 'reasoning',
      executionClass: 'fast',
      temperature: 0,
      maxTokens: 300,
      timeoutMs: 4500,
      maxProviderAttempts: 1,
      signal,
    })
    const parsed = parseJsonObject(result.content)
    if (!parsed) return { source: 'deterministic' }
    const meaning = boundedMeaning(parsed.meaning)
    const confidence = boundedConfidence(parsed.confidence)
    const suggestedIntent = typeof parsed.intent === 'string' && ALLOWED_INTENTS.has(parsed.intent as SemanticIntentHint) ? parsed.intent as SemanticIntentHint : undefined
    const suggestedSpeechAct = typeof parsed.speechAct === 'string' && ALLOWED_SPEECH_ACTS.has(parsed.speechAct as SemanticSpeechAct) ? parsed.speechAct as SemanticSpeechAct : undefined
    const suggestedCognitiveDepth = typeof parsed.cognitiveDepth === 'string' && ALLOWED_DEPTHS.has(parsed.cognitiveDepth as CognitiveDepth) ? parsed.cognitiveDepth as CognitiveDepth : undefined
    if (!meaning && confidence === undefined && !suggestedIntent && !suggestedSpeechAct && !suggestedCognitiveDepth) return { source: 'deterministic' }
    return { schemaVersion: 1, meaning, confidence, uncertainty: parseUncertainty(parsed.uncertainty), source: 'hybrid', suggestedIntent, suggestedSpeechAct, suggestedCognitiveDepth }
  } catch (error) {
    if (isCeoRequestAborted(error)) throw error
    return { source: 'deterministic' }
  }
}

export function semanticAssistanceRequired(context: CanonicalConversationContext): boolean { return shouldAssist(context) }
