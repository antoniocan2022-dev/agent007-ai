import { inferTaskType } from './canonical-llm-router'
import { classifyExecution } from './adaptive-execution'
import { classifyCeoSelfReflection, type SelfReflectionClassification } from './ceo-self-reflection'
import { buildConversationDecisionContract } from './ceo-conversation-decision-contract'
import { assessCeoCuriosity } from './ceo-curiosity'
import type { TaskType } from './subagent-governance'
import type { CeoExecutionContract, CeoIntent, EvidenceClass, EvidenceDomain, EvidenceOperation, EvidenceProfile, EvidenceRequirement, ExecutionRequirement, OrchestrationOwner, PreRouteDecision, TemporalScope } from './ceo-cognitive-contract'
import type { CanonicalConversationContext } from './ceo-cognitive-conversation'

const SIMPLE_RE = /^(what is|what's|who is|where is|when is|how much|how many|define|meaning of|translate|calculate)\b/i
const CONTEXT_RE = /\b(this|that|these|those|it|they|them|above|previous|prior|continue|again|same|more|also|instead|as before)\b/i
const DIRECT_CEO_MAX_CHARS = 1200
function latestUserText(messages: readonly { role: string; content: string }[]): string { return [...messages].reverse().find((message) => message.role === 'user' && typeof message.content === 'string')?.content ?? '' }

const MARKET_SECURITY_RE = /\b(?:stock(?:s)?|share(?:s)?|equity|ticker|market\s+cap(?:italization)?|valuation|earnings|financials?|price\s+target|p\/e|pe\s+ratio|eps|dividend|cash\s+flow|10-k|10-q|sec\s+filing|invest(?:ing|ment)?|portfolio)\b/i
const MARKET_ACTION_RE = /\b(?:analy[sz]e|analysis|assess|evaluate|compare|research|review|recommend(?:ation)?|should|invest|buy|sell|hold|trade|value|price)\b/i
const EXPLICIT_TICKER_RE = /\([A-Z]{1,5}\)/
const SHORT_TICKER_ACTION_RE = /\b(?:buy|sell|invest|trade)\s+(?:in\s+)?([A-Z]{1,5})\b/
const COMMON_ACRONYM_RE = /^(?:API|AWS|CPU|CRM|ERP|GPU|HTML|HTTP|HTTPS|RAM|SaaS|SDK|SQL|UI|URL|VPN|XML)$/
const COMPANY_ENTITY_RE = /\b(?:Inc\.?|Incorporated|Corp\.?|Corporation|Ltd\.?|Limited)\b/i
const MARKET_PHRASE_RE = /\b(?:stock(?:s)?|share(?:s)?|ticker|market\s+cap(?:italization)?|p\/e|pe\s+ratio|eps|price\s+target|sec\s+filing|invest(?:ing|ment)?|portfolio)\b/i
const INTERNAL_CONTEXT_RE = /\b(?:our|we|us|my|internal|spare\s+parts?|inventory|stockroom|warehouse|server|servers|equipment|founder(?:s)?|co-?founder(?:s)?|ownership\s+split|cash\s+flow\s+forecast|earnings\s+report|financial\s+forecast|budget|forecast|procurement|purchase\s+order|meeting|review\s+meeting|operational|parts?)\b/i
const INTERNAL_FINANCE_RE = /\b(?:our|my|internal)?\s*(?:earnings\s+report|financial\s+forecast|financials?|budget|accounts?|bookkeeping|accounting)\b/i
const INTERNAL_OPERATIONS_RE = /\b(?:spare\s+parts?|inventory|stockroom|warehouse|server(?:s)?|equipment|procurement|purchase\s+order|meeting|review\s+meeting|co-?founder(?:s)?|ownership\s+split|cash\s+flow\s+forecast|operations?|operational)\b/i
const TOOL_ACTION_RE = /\b(?:create|delete|edit|update|change|schedule|send|run|execute|fix|hold\s+(?:a|the)?\s*(?:review\s+)?meeting)\b/i

function isExternalEquityResearch(text: string): boolean {
  const tickerAction = text.match(SHORT_TICKER_ACTION_RE)
  if (tickerAction && !COMMON_ACRONYM_RE.test(tickerAction[1])) return !INTERNAL_CONTEXT_RE.test(text)
  if (!MARKET_SECURITY_RE.test(text) || !MARKET_ACTION_RE.test(text)) return false
  if (INTERNAL_CONTEXT_RE.test(text)) return false
  return EXPLICIT_TICKER_RE.test(text) || COMPANY_ENTITY_RE.test(text) || MARKET_PHRASE_RE.test(text)
}
function isExternalDomain(domain: EvidenceDomain): boolean { return domain !== 'none' && domain !== 'unknown' && domain !== 'general_web' && !domain.startsWith('internal_') }
function inferExternalDomain(text: string): EvidenceDomain {
  if (isExternalEquityResearch(text)) return 'public_equity'
  if (/\b(?:competitor|competitors|competitive|rivals?)\b/i.test(text)) return 'competitor'
  if (/\b(?:news|headline|headlines|breaking|latest events?)\b/i.test(text)) return 'news'
  if (/\b(?:market|markets|industry|sector|macro(?:economic)?)\b/i.test(text)) return 'market'
  if (/\b(?:regulation|regulatory|law|legal requirement|filing|compliance|rule|rules)\b/i.test(text)) return 'regulatory'
  if (/\b(?:due diligence|acquisition|acquire|supplier|vendor|customer|company profile)\b/i.test(text)) return 'business_due_diligence'
  if (INTERNAL_OPERATIONS_RE.test(text)) return 'internal_operations'
  if (INTERNAL_FINANCE_RE.test(text)) return 'internal_finance'
  return 'general_web'
}
function inferTemporalScope(text: string): TemporalScope {
  if (/\b(?:today|current|currently|right now|live|latest price|latest quote)\b/i.test(text)) return 'current'
  if (/\b(?:recent|recently|this week|this month|latest|newest|past few)\b/i.test(text)) return 'recent'
  if (/\b(?:historical|history|last year|over the last|over five years|5-year|10-year)\b/i.test(text)) return 'historical'
  return 'current'
}
function inferEvidenceProfile(domain: EvidenceDomain, _temporalScope: TemporalScope): EvidenceProfile {
  if (domain === 'public_equity') return 'public_equity'
  if (domain === 'market') return 'market_current'
  if (domain === 'news') return 'news_recent'
  if (domain === 'competitor') return 'competitor_research'
  if (domain === 'business_due_diligence') return 'business_due_diligence'
  return 'general_research'
}
function inferEvidenceOperation(text: string): EvidenceOperation {
  if (/\b(?:would\s+you\s+invest|should\s+i|should\s+we|recommend(?:ation)?|invest(?:ing|ment)?|buy|sell|hold)\b/i.test(text)) return 'recommend'
  if (/\b(?:compare|versus|vs\.?|better|stronger|weaker)\b/i.test(text)) return 'compare'
  if (/\b(?:forecast|project|outlook|future|estimate)\b/i.test(text)) return 'forecast'
  if (/\b(?:verify|validate|confirm|fact[- ]check)\b/i.test(text)) return 'verify'
  if (/\b(?:explain|what\s+is|who\s+is)\b/i.test(text)) return 'explain'
  if (/\b(?:research|look\s+up|find\s+(?:out|information))\b/i.test(text)) return 'research'
  return /\b(?:analy[sz]e|analysis|assess|evaluate|review)\b/i.test(text) ? 'analyze' : 'research'
}
function buildExecutionContract(input: { intent: CeoIntent; selfReflectionKind?: SelfReflectionClassification['kind']; evidenceClass: EvidenceClass; domain: EvidenceDomain; operation: EvidenceOperation; temporalScope: TemporalScope; evidenceProfile: EvidenceProfile; evidenceRequirement: EvidenceRequirement; executionRequirement: ExecutionRequirement; orchestrationOwner: OrchestrationOwner; maxTurns: number; maxRecoveries: number; latencyBudgetMs: number; toolRequired: boolean; subagentsRequired: boolean; reason: string }): CeoExecutionContract { return { ...input } }
function contractFor(input: { intent: CeoIntent; selfReflectionKind?: SelfReflectionClassification['kind']; adaptiveExecutionClass: 'fast' | 'standard' | 'deep' | 'mission'; missionRelevant: boolean; reason: string; evidenceClass?: EvidenceClass; domain?: EvidenceDomain; operation?: EvidenceOperation; temporalScope?: TemporalScope; evidenceProfile?: EvidenceProfile }): CeoExecutionContract {
  const { intent, selfReflectionKind, adaptiveExecutionClass, missionRelevant, reason, evidenceClass = intent === 'conversation' ? 'none' : 'internal_state', domain = intent === 'conversation' ? 'none' : 'internal_operations', operation = intent === 'conversation' ? 'none' : 'analyze', temporalScope = intent === 'conversation' ? 'none' : 'timeless', evidenceProfile = intent === 'conversation' ? 'none' : 'none' } = input
  if (intent === 'self_assessment') return buildExecutionContract({ intent, selfReflectionKind, evidenceClass: 'internal_state', domain: 'internal_operations', operation: 'analyze', temporalScope: 'current', evidenceProfile: 'none', evidenceRequirement: 'internal_state', executionRequirement: 'llm_only', orchestrationOwner: 'ceo_lifecycle', maxTurns: 2, maxRecoveries: 0, latencyBudgetMs: 30000, toolRequired: false, subagentsRequired: false, reason })
  if (intent === 'conversation') return buildExecutionContract({ intent, evidenceClass: 'none', domain: 'none', operation: 'none', temporalScope: 'none', evidenceProfile: 'none', evidenceRequirement: 'none', executionRequirement: 'llm_only', orchestrationOwner: 'ceo_lifecycle', maxTurns: 1, maxRecoveries: 0, latencyBudgetMs: 15000, toolRequired: false, subagentsRequired: false, reason })
  if (intent === 'analysis' || intent === 'opinion' || intent === 'decision') return buildExecutionContract({ intent, evidenceClass, domain, operation, temporalScope, evidenceProfile, evidenceRequirement: evidenceClass === 'external_web' ? 'external_web' : 'none', executionRequirement: evidenceClass === 'external_web' ? 'multi_source' : 'llm_only', orchestrationOwner: 'ceo_lifecycle', maxTurns: adaptiveExecutionClass === 'deep' ? 3 : 1, maxRecoveries: evidenceClass === 'external_web' ? 1 : 0, latencyBudgetMs: evidenceClass === 'external_web' ? 120000 : (adaptiveExecutionClass === 'deep' ? 30000 : 15000), toolRequired: evidenceClass === 'external_web', subagentsRequired: false, reason })
  if (intent === 'production_action') return buildExecutionContract({ intent, evidenceClass: 'internal_state', domain: 'internal_operations', operation: 'verify', temporalScope: 'current', evidenceProfile: 'none', evidenceRequirement: 'live_system', executionRequirement: 'production', orchestrationOwner: 'operational_orchestrator', maxTurns: 6, maxRecoveries: 1, latencyBudgetMs: 60000, toolRequired: true, subagentsRequired: false, reason })
  if (intent === 'research') { const isEquity = domain === 'public_equity'; return buildExecutionContract({ intent, evidenceClass: 'external_web', domain, operation, temporalScope, evidenceProfile, evidenceRequirement: isEquity ? 'multi_source' : 'external_web', executionRequirement: isEquity ? 'multi_source' : 'one_tool', orchestrationOwner: isEquity ? 'ceo_lifecycle' : 'operational_orchestrator', maxTurns: isEquity ? 8 : (adaptiveExecutionClass === 'deep' ? 6 : 4), maxRecoveries: isEquity ? 2 : 1, latencyBudgetMs: isEquity ? 120000 : (adaptiveExecutionClass === 'deep' ? 60000 : 30000), toolRequired: true, subagentsRequired: false, reason }) }
  if (intent === 'tool_action') return buildExecutionContract({ intent, evidenceClass: 'internal_state', domain: 'internal_operations', operation, temporalScope: 'current', evidenceProfile: 'none', evidenceRequirement: 'internal_state', executionRequirement: 'one_tool', orchestrationOwner: 'operational_orchestrator', maxTurns: adaptiveExecutionClass === 'deep' ? 6 : 4, maxRecoveries: 1, latencyBudgetMs: adaptiveExecutionClass === 'deep' ? 60000 : 30000, toolRequired: true, subagentsRequired: false, reason }) }
  if (missionRelevant || intent === 'mission_action') return buildExecutionContract({ intent: 'mission_action', evidenceClass: 'mixed', domain: 'business_due_diligence', operation: 'decide', temporalScope: 'current', evidenceProfile: 'business_due_diligence', evidenceRequirement: 'multi_source', executionRequirement: 'mission', orchestrationOwner: 'operational_orchestrator', maxTurns: 12, maxRecoveries: 2, latencyBudgetMs: 60000, toolRequired: true, subagentsRequired: true, reason })
  return buildExecutionContract({ intent, evidenceClass, domain, operation, temporalScope, evidenceProfile, evidenceRequirement: evidenceClass === 'external_web' ? 'external_web' : 'none', executionRequirement: evidenceClass === 'external_web' ? 'multi_source' : 'one_tool', orchestrationOwner: evidenceClass === 'external_web' ? 'ceo_lifecycle' : 'operational_orchestrator', maxTurns: adaptiveExecutionClass === 'deep' ? 6 : 4, maxRecoveries: 1, latencyBudgetMs: adaptiveExecutionClass === 'deep' ? 60000 : 30000, toolRequired: evidenceClass === 'external_web' || intent === 'tool_action', subagentsRequired: false, reason })
}
function inferSemanticIntent(text: string, selfReflection: SelfReflectionClassification): CeoIntent {
  if (selfReflection.isSelfReflective) return 'self_assessment'
  if (/\b(?:deploy|publish|production|ship|launch)\b/i.test(text)) return 'production_action'
  if (/\b(?:mission|autonom(?:y|ous)|venture|revenue|transaction)\b/i.test(text) && /\b(?:run|start|execute|manage|launch|create|fix|implement)\b/i.test(text)) return 'mission_action'
  if (isExternalEquityResearch(text)) return 'research'
  if (/\b(?:research|search|look\s+up|find\s+(?:out|information)|verify|validate)\b/i.test(text)) return 'research'
  if (TOOL_ACTION_RE.test(text)) return 'tool_action'
  if (/\b(?:analy[sz]e|analysis|assess|evaluate|review|diagnose|compare|strategy|strategic|root\s+cause)\b/i.test(text)) return 'analysis'
  if (/\b(?:should|recommend|recommendation|choose|pick|decision)\b/i.test(text)) return 'decision'
  if (/\b(?:think|opinion|take on|agree|disagree|feel)\b/i.test(text)) return 'opinion'
  if (/^(?:hi|hello|hey|good\s+(?:morning|afternoon|evening)|thanks|thank\s+you|ok|okay|great|perfect|how\s+do\s+you\s+do|how\s+do\s+you\s+doing?)\b/i.test(text)) return 'conversation'
  return 'conversation'
}
function semanticIntentToCeoIntent(context?: CanonicalConversationContext): CeoIntent | undefined {
  if (!context || context.semanticInterpretation.source === 'deterministic' || context.semanticInterpretation.confidence < 0.72) return undefined
  if (context.speechAct === 'correction') return 'conversation'
  if (context.intentHint === 'self_assessment') return 'self_assessment'
  if (context.intentHint === 'conversation') return 'conversation'
  if (context.intentHint === 'analysis') return 'analysis'
  if (context.intentHint === 'decision') return 'decision'
  if (context.intentHint === 'research') return 'research'
  if (context.intentHint === 'action') return 'tool_action'
  return undefined
}
function buildDecision(input: { route: PreRouteDecision['route']; reason: string; missionRelevant: boolean; complexitySignals: number; taskClass?: TaskType; adaptiveExecutionClass: 'fast' | 'standard' | 'deep' | 'mission'; executionContract: CeoExecutionContract }): PreRouteDecision { return input }

export function preRouteCeoRequest(messages: readonly { role: string; content: string }[], attachmentsCount = 0, semanticContext?: CanonicalConversationContext): PreRouteDecision {
  const text = latestUserText(messages).replace(/\s+/g, ' ').trim()
  const selfReflection = classifyCeoSelfReflection(text)
  const adaptive = classifyExecution(messages, selfReflection)
  const taskClass = inferTaskType(messages)
  const deterministicIntent = inferSemanticIntent(text, selfReflection)
  const assistedIntent = semanticIntentToCeoIntent(semanticContext)
  const semanticIntent = deterministicIntent === 'self_assessment' ? 'self_assessment' : (assistedIntent ?? deterministicIntent)
  const canonicalDecision = semanticContext ? buildConversationDecisionContract(semanticContext) : undefined
  const curiosity = semanticContext && canonicalDecision ? assessCeoCuriosity(semanticContext, canonicalDecision) : null
  const explicitOperational = semanticIntent === 'production_action' || semanticIntent === 'tool_action' || semanticIntent === 'research' || semanticIntent === 'mission_action'
  const externalSubjectDomain = inferExternalDomain(text)
  const legacyExternalEvidence = isExternalDomain(externalSubjectDomain) && (semanticIntent === 'research' || semanticIntent === 'analysis' || semanticIntent === 'decision' || semanticIntent === 'opinion')
  const canonicalExternalEvidence = Boolean(canonicalDecision && curiosity?.investigate)
  const shouldUseExternalEvidence = semanticContext ? canonicalExternalEvidence : legacyExternalEvidence
  const evidenceClass: EvidenceClass | undefined = shouldUseExternalEvidence ? 'external_web' : undefined
  const domain: EvidenceDomain | undefined = semanticIntent === 'research' || shouldUseExternalEvidence || externalSubjectDomain.startsWith('internal_') ? externalSubjectDomain : undefined
  const effectiveExecutionClass = externalSubjectDomain === 'public_equity' ? 'deep' : adaptive.executionClass
  if (!text) { const reason = 'No substantive request detected.'; return buildDecision({ route: 'fast', reason, missionRelevant: false, complexitySignals: 0, taskClass, adaptiveExecutionClass: 'fast', executionContract: contractFor({ intent: 'conversation', adaptiveExecutionClass: 'fast', missionRelevant: false, reason }) }) }
  const missionRelevant = semanticIntent === 'mission_action' || (adaptive.executionClass === 'mission' && !explicitOperational)
  const complexitySignals = [effectiveExecutionClass === 'deep' || effectiveExecutionClass === 'mission', text.length > DIRECT_CEO_MAX_CHARS, /\b(and|then|because|including|with|plus)\b/i.test(text)].filter(Boolean).length
  if (attachmentsCount > 0) { const reason = 'Attachments require contextual inspection and cannot use the direct CEO conversational lane.'; const temporalScope = domain && shouldUseExternalEvidence ? inferTemporalScope(text) : undefined; const operation = domain && shouldUseExternalEvidence ? inferEvidenceOperation(text) : undefined; const evidenceProfile = domain && shouldUseExternalEvidence ? inferEvidenceProfile(domain, temporalScope!) : undefined; return buildDecision({ route: 'full', reason, missionRelevant, complexitySignals, taskClass, adaptiveExecutionClass: effectiveExecutionClass, executionContract: contractFor({ intent: semanticIntent, selfReflectionKind: selfReflection.kind, adaptiveExecutionClass: effectiveExecutionClass, missionRelevant, reason, ...(evidenceClass ? { evidenceClass } : {}), ...(domain ? { domain } : {}), ...(operation ? { operation } : {}), ...(temporalScope ? { temporalScope } : {}), ...(evidenceProfile ? { evidenceProfile } : {}) }) }) }
  if (semanticIntent === 'self_assessment') { const reason = 'Self-assessment stays CEO-owned and bounded; no operational tools are required.'; return buildDecision({ route: 'fast', reason, missionRelevant: false, complexitySignals, taskClass, adaptiveExecutionClass: 'fast', executionContract: contractFor({ intent: 'self_assessment', selfReflectionKind: selfReflection.kind, adaptiveExecutionClass: 'fast', missionRelevant: false, reason }) }) }
  const temporalScope = domain && shouldUseExternalEvidence ? inferTemporalScope(text) : undefined
  const operation = domain && shouldUseExternalEvidence ? inferEvidenceOperation(text) : undefined
  const evidenceProfile = domain && shouldUseExternalEvidence ? inferEvidenceProfile(domain, temporalScope!) : undefined
  const executionContract = contractFor({ intent: semanticIntent, adaptiveExecutionClass: effectiveExecutionClass, missionRelevant, reason: curiosity?.reason ?? 'Canonical semantic routing decision.', ...(evidenceClass ? { evidenceClass } : {}), ...(domain ? { domain } : {}), ...(operation ? { operation } : {}), ...(temporalScope ? { temporalScope } : {}), ...(evidenceProfile ? { evidenceProfile } : {}) })
  if (semanticContext && canonicalDecision) {
    const externallyRequired = curiosity?.investigate === true
    const canonicalToolRequired = canonicalDecision.toolRequirement === 'required'
    executionContract.evidenceClass = externallyRequired ? 'external_web' : 'none'
    executionContract.evidenceRequirement = externallyRequired ? 'external_web' : 'none'
    executionContract.toolRequired = canonicalToolRequired || externallyRequired
    if (!executionContract.toolRequired && canonicalDecision.toolRequirement === 'none') executionContract.executionRequirement = 'llm_only'
  }
  if (semanticIntent === 'research' || evidenceClass === 'external_web') return buildDecision({ route: 'full', reason: curiosity?.reason ?? 'External evidence requires governed execution.', missionRelevant, complexitySignals, taskClass, adaptiveExecutionClass: effectiveExecutionClass, executionContract })
  if (semanticIntent === 'mission_action' || missionRelevant) return buildDecision({ route: 'full', reason: 'Mission-relevant work requires governed orchestration.', missionRelevant, complexitySignals, taskClass, adaptiveExecutionClass: effectiveExecutionClass, executionContract })
  if (semanticIntent === 'tool_action' || semanticIntent === 'production_action') return buildDecision({ route: 'full', reason: 'Operational actions require governed tools.', missionRelevant, complexitySignals, taskClass, adaptiveExecutionClass: effectiveExecutionClass, executionContract })
  const contextMatch = text.match(CONTEXT_RE)
  const hasSelfContainedAntecedent = Boolean(contextMatch && contextMatch.index !== undefined && contextMatch.index >= 30 && /,| and /i.test(text.slice(0, contextMatch.index)))
  if (contextMatch && !SIMPLE_RE.test(text) && !hasSelfContainedAntecedent) { const reason = 'Context-dependent request requires richer conversational analysis.'; return buildDecision({ route: 'ambiguous', reason, missionRelevant, complexitySignals, taskClass, adaptiveExecutionClass: 'standard', executionContract: contractFor({ intent: semanticIntent, adaptiveExecutionClass: 'standard', missionRelevant: false, reason }) }) }
  const useFast = effectiveExecutionClass === 'fast' && (SIMPLE_RE.test(text) || text.length <= DIRECT_CEO_MAX_CHARS)
  return buildDecision({ route: useFast ? 'fast' : 'full', reason: useFast ? 'Bounded direct CEO response.' : 'Complexity/context requires full CEO lifecycle.', missionRelevant, complexitySignals, taskClass, adaptiveExecutionClass: useFast ? 'fast' : effectiveExecutionClass, executionContract })
}
export function resolvePreRoute(decision: PreRouteDecision): 'fast' | 'full' { return decision.route === 'fast' && !decision.executionContract.toolRequired ? 'fast' : 'full' }
