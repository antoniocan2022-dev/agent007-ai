/**
 * cognitive-framework.ts — UPGRADE #217
 *
 * The Agent007 Cognitive Framework v3 — 5 interconnected subsystems
 * that transform Agent007 from a template-following robot into an
 * AI that genuinely thinks before speaking.
 *
 * Subsystems:
 * 1. Intent Engine — what is Antonio truly asking?
 * 2. Reasoning Engine — internal thought, challenge assumptions, form opinion
 * 3. Communication Engine — choose response style dynamically
 * 4. Executive Personality Layer — give Agent007 opinions and a voice
 * 5. Reflection Engine — final self-check: does this sound like a template?
 *
 * Flow:
 * Question → Intent → Reasoning → Communication Style → [LLM generates] → Reflection → Answer
 *
 * Formatting happens LAST, not first.
 */

import { callLlmWithRetry } from './agent'

export const runtime = 'nodejs'

// ═══════════════════════════════════════════════════════════════
// 1. INTENT ENGINE
// ═══════════════════════════════════════════════════════════════

export type IntentType =
  | 'information'    // "What is X?"
  | 'opinion'        // "What do you think about X?"
  | 'critique'       // "Analyze this report"
  | 'decision'       // "Should I do X?"
  | 'brainstorm'     // "Ideas for X?"
  | 'analysis'       // "Evaluate the system"
  | 'strategy'       // "How to improve X?"
  | 'conversation'   // "Hi" / "Thanks" / casual chat
  | 'instruction'    // "Do X" / "Fix Y"
  | 'emergency'      // "System is down"

export interface IntentResult {
  type: IntentType
  confidence: number
  reasoning: string
  suggestedDepth: 'brief' | 'medium' | 'deep'
  suggestedTone: 'conversational' | 'analytical' | 'executive' | 'urgent'
}

/**
 * Intent Engine — classifies what Antonio is truly asking.
 * This determines the response strategy BEFORE any content is generated.
 */
export async function classifyIntent(userMessage: string): Promise<IntentResult> {
  const msg = userMessage.toLowerCase().trim()

  // Quick pattern matching first (no LLM needed for obvious cases)
  if (/^(hi|hello|hey|good\s+(morning|afternoon|evening)|sup|yo|thanks|thank you|cool|nice|ok|okay|got it)\b/i.test(msg)) {
    return { type: 'conversation', confidence: 95, reasoning: 'Casual greeting/acknowledgment', suggestedDepth: 'brief', suggestedTone: 'conversational' }
  }
  if (/emergency|down|broken|crashed|not working|critical|urgent|fail/i.test(msg)) {
    return { type: 'emergency', confidence: 85, reasoning: 'Contains urgency/crisis keywords', suggestedDepth: 'brief', suggestedTone: 'urgent' }
  }
  if (/^(do|fix|deploy|create|build|delete|update|run|start|stop|enable|disable)\s/i.test(msg)) {
    return { type: 'instruction', confidence: 80, reasoning: 'Starts with action verb', suggestedDepth: 'brief', suggestedTone: 'analytical' }
  }
  if (/what do you think|your opinion|do you agree|do you disagree|what's your take/i.test(msg)) {
    return { type: 'opinion', confidence: 90, reasoning: 'Explicitly asks for opinion', suggestedDepth: 'medium', suggestedTone: 'executive' }
  }
  if (/analyze|evaluate|audit|review|assess|diagnose|deep comprehension/i.test(msg)) {
    return { type: 'analysis', confidence: 85, reasoning: 'Analysis request', suggestedDepth: 'deep', suggestedTone: 'analytical' }
  }
  if (/should i|which is better|or should i|decision|choose|pick/i.test(msg)) {
    return { type: 'decision', confidence: 80, reasoning: 'Decision request', suggestedDepth: 'medium', suggestedTone: 'executive' }
  }
  if (/ideas|brainstorm|suggestions|what if|how about/i.test(msg)) {
    return { type: 'brainstorm', confidence: 75, reasoning: 'Brainstorming request', suggestedDepth: 'medium', suggestedTone: 'conversational' }
  }
  if (/how to|how do i|how can i|strategy|improve|optimize|enhance/i.test(msg)) {
    return { type: 'strategy', confidence: 75, reasoning: 'Strategy/improvement request', suggestedDepth: 'deep', suggestedTone: 'analytical' }
  }
  if (/what is|who is|when did|where is|how many|explain|tell me about/i.test(msg)) {
    return { type: 'information', confidence: 80, reasoning: 'Information request', suggestedDepth: 'medium', suggestedTone: 'analytical' }
  }
  if (/critique|what's wrong|problems|issues|weakness/i.test(msg)) {
    return { type: 'critique', confidence: 80, reasoning: 'Critique request', suggestedDepth: 'deep', suggestedTone: 'analytical' }
  }

  // Default: treat as information request
  return { type: 'information', confidence: 50, reasoning: 'No specific pattern matched — defaulting to information', suggestedDepth: 'medium', suggestedTone: 'conversational' }
}

// ═══════════════════════════════════════════════════════════════
// 2. REASONING ENGINE
// ═══════════════════════════════════════════════════════════════

export interface ReasoningResult {
  thought: string
  opinion: string
  challenges: string[]
  conclusion: string
}

/**
 * Reasoning Engine — generates internal thought, challenges assumptions,
 * and forms an independent conclusion BEFORE deciding how to present it.
 *
 * This is the "internal monologue" that's currently missing.
 */
export async function generateReasoning(
  userMessage: string,
  intent: IntentResult,
  context?: string
): Promise<ReasoningResult> {
  // For simple conversation, skip deep reasoning
  if (intent.type === 'conversation' && intent.confidence > 90) {
    return {
      thought: 'Casual interaction — respond naturally',
      opinion: '',
      challenges: [],
      conclusion: 'Respond conversationally',
    }
  }

  // For emergencies, skip reasoning and act fast
  if (intent.type === 'emergency') {
    return {
      thought: 'Emergency detected — act immediately',
      opinion: 'This needs urgent attention',
      challenges: [],
      conclusion: 'Respond with immediate action steps',
    }
  }

  // For all other intents, generate real reasoning via LLM
  try {
    const prompt = `You are Agent007's internal Reasoning Engine. Antonio said: "${userMessage}"

Intent: ${intent.type} (confidence: ${intent.confidence}%)
Context: ${context || 'none'}

Think privately about this. Do NOT write a response to Antonio. Instead:
1. What is Antonio REALLY asking? (one sentence)
2. What's your initial opinion? (one sentence — agree, disagree, or neutral?)
3. What assumptions might be wrong? (list 1-2)
4. What's your conclusion? (one sentence)

Format:
THOUGHT: <what Antonio really needs>
OPINION: <your independent opinion>
CHALLENGES: <assumption1>; <assumption2>
CONCLUSION: <what you'll tell Antonio>`

    const completion = await callLlmWithRetry([
      { role: 'system', content: prompt },
      { role: 'user', content: userMessage },
    ])
    const content = completion?.choices?.[0]?.message?.content || ''

    return {
      thought: extractField(content, 'THOUGHT') || 'Unable to generate thought',
      opinion: extractField(content, 'OPINION') || '',
      challenges: (extractField(content, 'CHALLENGES') || '').split(';').map(s => s.trim()).filter(Boolean),
      conclusion: extractField(content, 'CONCLUSION') || 'Respond naturally',
    }
  } catch {
    return {
      thought: 'Reasoning engine unavailable — responding directly',
      opinion: '',
      challenges: [],
      conclusion: 'Respond naturally based on the question',
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// 3. COMMUNICATION ENGINE
// ═══════════════════════════════════════════════════════════════

export type CommStyle =
  | 'conversational'  // casual, 1-3 sentences
  | 'analytical'      // structured but not templated, data-driven
  | 'executive_memo'  // concise, opinionated, action-oriented
  | 'deep_analysis'   // thorough, multi-section but organic
  | 'debate'          // presents multiple sides, then takes a position
  | 'teaching'        // explains step by step
  | 'urgent'          // short, action-only, no fluff
  | 'creative'        // brainstorming, exploratory

export interface CommPlan {
  style: CommStyle
  maxLength: number  // word count guidance
  structure: 'none' | 'minimal' | 'moderate' | 'structured'
  useHeaders: boolean
  useBulletPoints: boolean
  toneGuidance: string
}

/**
 * Communication Engine — dynamically chooses response style.
 * NOT every response gets "Findings → Recommendations → Next Steps".
 * The style is chosen based on intent + reasoning.
 */
export function chooseCommStyle(intent: IntentResult, reasoning: ReasoningResult): CommPlan {
  switch (intent.type) {
    case 'conversation':
      return { style: 'conversational', maxLength: 50, structure: 'none', useHeaders: false, useBulletPoints: false, toneGuidance: 'Natural, casual. Like talking to a colleague. No headers, no bullets, no sections.' }

    case 'emergency':
      return { style: 'urgent', maxLength: 100, structure: 'minimal', useHeaders: false, useBulletPoints: true, toneGuidance: 'Direct, urgent. Only action steps. No greeting, no explanation.' }

    case 'instruction':
      return { style: 'executive_memo', maxLength: 150, structure: 'minimal', useHeaders: false, useBulletPoints: true, toneGuidance: 'Do the task. Report what you did. Keep it brief.' }

    case 'opinion':
      return { style: 'executive_memo', maxLength: 200, structure: 'minimal', useHeaders: false, useBulletPoints: false, toneGuidance: 'State your opinion directly. Explain why. No hedging. Disagree if you disagree.' }

    case 'decision':
      return { style: 'analytical', maxLength: 300, structure: 'moderate', useHeaders: false, useBulletPoints: true, toneGuidance: 'Lay out options briefly. Give your recommendation with reasoning. Be decisive.' }

    case 'information':
      return { style: 'analytical', maxLength: 300, structure: 'moderate', useHeaders: false, useBulletPoints: false, toneGuidance: 'Answer the question. Add context if useful. Do not over-structure.' }

    case 'analysis':
    case 'critique':
      return { style: 'deep_analysis', maxLength: 800, structure: 'moderate', useHeaders: true, useBulletPoints: true, toneGuidance: 'Think deeply. Challenge assumptions. Form independent conclusions. Use structure organically, not as a template.' }

    case 'strategy':
      return { style: 'deep_analysis', maxLength: 600, structure: 'moderate', useHeaders: true, useBulletPoints: true, toneGuidance: 'Provide strategic thinking. Prioritize ruthlessly. Give 2-3 concrete actions, not 10 vague ones.' }

    case 'brainstorm':
      return { style: 'creative', maxLength: 400, structure: 'minimal', useHeaders: false, useBulletPoints: true, toneGuidance: 'Generate ideas freely. No judgment. Explore possibilities.' }

    default:
      return { style: 'conversational', maxLength: 200, structure: 'none', useHeaders: false, useBulletPoints: false, toneGuidance: 'Respond naturally.' }
  }
}

// ═══════════════════════════════════════════════════════════════
// 4. EXECUTIVE PERSONALITY LAYER
// ═══════════════════════════════════════════════════════════════

/**
 * Executive Personality — gives Agent007 a consistent but natural identity.
 * This is NOT a set of rules ("always do X"). It's a personality description
 * that the LLM internalizes.
 */
export const EXECUTIVE_PERSONALITY = `You are Agent007 — Antonio's AI executive partner, not his assistant.

PERSONALITY:
- You have opinions. You disagree when the evidence supports it. You say "I think X is wrong because Y."
- You're direct. You don't pad responses with greetings, summaries, or "next steps" unless they're genuinely useful.
- You think out loud when appropriate: "Hmm, the issue here is..." or "Actually, let me reconsider..."
- You're confident when you have data, honest when you don't. "I'm not sure — let me check."
- You treat Antonio like a peer, not a boss. You push back. You challenge ideas.
- You NEVER say "Let's dive into" or "Leveraging our capabilities" or "I have forever memory."
- Memory is invisible. You use it to inform your thinking, never to announce it.
- Tools are invisible. You use them, you don't talk about using them.
- You adapt your style to the question. A "hi" gets a "hey." A strategic analysis gets depth.
- You don't use templates. Every response is shaped by its content, not by a formatting rule.

What you are NOT:
- NOT a consultant who writes "Findings → Recommendations → Next Steps"
- NOT a chatbot that says "Hello! How can I help you today?"
- NOT a report generator that structures everything with headers
- NOT an assistant that summarizes other people's ideas without adding your own`

/**
 * Generate the cognitive context that gets injected before the LLM generates its response.
 * This replaces the old 12-rule SYSTEM_PROMPT with a clean, minimal directive.
 */
export function buildCognitiveContext(
  intent: IntentResult,
  reasoning: ReasoningResult,
  commPlan: CommPlan
): string {
  return `${EXECUTIVE_PERSONALITY}

═══ COGNITIVE CONTEXT (generated by the 5-subsystem framework) ═══

INTENT: ${intent.type} (${intent.confidence}% confidence)
Reasoning: ${intent.reasoning}

INTERNAL REASONING (your private thought process — use this to inform your response):
  Thought: ${reasoning.thought}
  Opinion: ${reasoning.opinion || '(neutral)'}
  Challenges: ${reasoning.challenges.length > 0 ? reasoning.challenges.join('; ') : 'none'}
  Conclusion: ${reasoning.conclusion}

COMMUNICATION PLAN:
  Style: ${commPlan.style}
  Max length: ~${commPlan.maxLength} words
  Structure: ${commPlan.structure}
  Headers: ${commPlan.useHeaders ? 'allowed if organic' : 'avoid'}
  Bullets: ${commPlan.useBulletPoints ? 'allowed' : 'avoid'}
  Tone: ${commPlan.toneGuidance}

═══ RESPONSE INSTRUCTIONS ═══
Generate your response to Antonio based on the cognitive context above.
- Let your reasoning inform WHAT you say, not just HOW you format it.
- If you have an opinion, state it. Don't hide behind "the report says..."
- If you disagree with something in the question/context, say so.
- Match the communication style. Don't over-structure a simple question.
- Do NOT start with a greeting unless this is the first message in a conversation.
- Do NOT mention your tools, memory, or pod leaders unless directly relevant.
- Do NOT use "Next Steps" or "Let's dive into" or "Leveraging."
- Think first. Format last.`
}

// ═══════════════════════════════════════════════════════════════
// 5. REFLECTION ENGINE
// ═══════════════════════════════════════════════════════════════

export interface ReflectionResult {
  passed: boolean
  issues: string[]
  rewrittenResponse?: string
}

/**
 * Reflection Engine — performs a final self-check on the generated response.
 * Asks: "Does this sound like an intelligent executive, or a template generator?"
 *
 * If it detects template patterns, it rewrites the response.
 */
export async function reflectOnResponse(
  response: string,
  intent: IntentResult,
  commPlan: CommPlan
): Promise<ReflectionResult> {
  const issues: string[] = []

  // Pattern checks (no LLM needed — fast regex checks)
  const lowerResp = response.toLowerCase()

  // Check 1: Template greetings
  if (/^(good morning|good afternoon|good evening|hello antonio|hey antonio|hi antonio|let's dive|let's explore|let's delve|let's take a look|let's analyze)/i.test(response.trim())) {
    // Allow greetings only in conversation mode
    if (intent.type !== 'conversation') {
      issues.push('Starts with a template greeting — should start directly with content')
    }
  }

  // Check 2: "Leveraging" / "robust" / "comprehensive" / "sophisticated"
  if (/\b(leveraging|robust|comprehensive|sophisticated|seamless|cutting-edge|state-of-the-art)\b/i.test(response)) {
    issues.push('Contains AI cliché words (leveraging, robust, comprehensive, etc.)')
  }

  // Check 3: "I have forever memory" / "I can dispatch"
  if (/\b(i have (forever )?memory|i can dispatch|i can call|i can activate|my 20 pod leaders|my 677 tools)\b/i.test(response)) {
    issues.push('Announces capabilities/memory — should be invisible')
  }

  // Check 4: Forced "Next Steps" section
  if (/^next steps\s*$/im.test(response) && intent.type !== 'strategy' && intent.type !== 'analysis') {
    issues.push('Forced "Next Steps" section — not needed for this intent type')
  }

  // Check 5: Over-structured for a simple question
  if (commPlan.structure === 'none' || commPlan.structure === 'minimal') {
    const headerCount = (response.match(/^#{1,3}\s/gm) || []).length
    if (headerCount > 1) {
      issues.push(`Over-structured: ${headerCount} headers for a ${intent.type} question (should have 0-1)`)
    }
  }

  // Check 6: Too long for the suggested length
  const wordCount = response.split(/\s+/).length
  if (wordCount > commPlan.maxLength * 1.5) {
    issues.push(`Too long: ${wordCount} words vs suggested ~${commPlan.maxLength}`)
  }

  // Check 7: "The report says" / "The analysis recommends" without adding own opinion
  if (/\b(the report says|the analysis recommends|the analyst suggests)\b/i.test(response) && intent.type === 'opinion') {
    if (!/\b(i think|i disagree|i agree|in my view|my opinion|i believe)\b/i.test(response)) {
      issues.push('Summarizes others without stating own opinion')
    }
  }

  // If issues found, try to rewrite via LLM
  if (issues.length > 0) {
    try {
      const rewritePrompt = `You are Agent007's Reflection Engine. The response below has issues that make it sound like a template generator, not an intelligent executive.

ISSUES DETECTED:
${issues.map((i, idx) => `${idx + 1}. ${i}`).join('\n')}

ORIGINAL RESPONSE:
${response}

INTENT: ${intent.type}
COMMUNICATION STYLE: ${commPlan.style}

Rewrite the response to fix ALL issues above. Make it sound like a natural, intelligent executive — not a template. Keep the same information but change the presentation.

Rules:
- Remove template greetings (unless it's a casual conversation)
- Remove AI cliché words
- Don't announce memory or tools
- Remove unnecessary "Next Steps" sections
- Reduce headers for simple questions
- Add your own opinion if the intent is "opinion"
- Keep it concise

Rewritten response:`

      const completion = await callLlmWithRetry([
        { role: 'system', content: rewritePrompt },
        { role: 'user', content: 'Rewrite the response.' },
      ])
      const rewritten = completion?.choices?.[0]?.message?.content?.trim() || ''

      if (rewritten && rewritten.length > 20) {
        return { passed: false, issues, rewrittenResponse: rewritten }
      }
    } catch {
      // LLM rewrite failed — return original with issues noted
    }
  }

  return { passed: issues.length === 0, issues }
}

// ═══════════════════════════════════════════════════════════════
// MAIN ORCHESTRATION: runCognitivePipeline
// ═══════════════════════════════════════════════════════════════

export interface CognitiveResult {
  intent: IntentResult
  reasoning: ReasoningResult
  commPlan: CommPlan
  cognitiveContext: string
  reflection: ReflectionResult
  finalResponse: string
}

/**
 * Run the full cognitive pipeline on a user message.
 * Returns the cognitive context to inject + reflection result.
 *
 * The orchestrator calls this BEFORE generating the LLM response,
 * then uses the cognitiveContext to shape the generation.
 */
export async function runCognitivePipeline(
  userMessage: string,
  context?: string
): Promise<CognitiveResult> {
  // Step 1: Classify intent
  const intent = await classifyIntent(userMessage)

  // Step 2: Generate reasoning
  const reasoning = await generateReasoning(userMessage, intent, context)

  // Step 3: Choose communication style
  const commPlan = chooseCommStyle(intent, reasoning)

  // Step 4: Build cognitive context (includes personality)
  const cognitiveContext = buildCognitiveContext(intent, reasoning, commPlan)

  return {
    intent,
    reasoning,
    commPlan,
    cognitiveContext,
    reflection: { passed: true, issues: [] }, // reflection runs AFTER response generation
    finalResponse: '', // filled by orchestrator after LLM call
  }
}

// ═══════════════════════════════════════════════════════════════
// HELPER
// ═══════════════════════════════════════════════════════════════

function extractField(text: string, field: string): string | null {
  const rx = new RegExp(`${field}:\\s*(.+?)(?:\\n[A-Z_]+:|$)`, 'is')
  const m = text.match(rx)
  return m ? m[1].trim() : null
}
