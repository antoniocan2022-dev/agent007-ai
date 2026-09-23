import { inferTaskType } from './canonical-llm-router'
import { classifyExecution } from './adaptive-execution'
import { classifyCeoSelfReflection, type SelfReflectionClassification } from './ceo-self-reflection'
import { buildConversationDecisionContract, type ConversationDecisionContract } from './ceo-conversation-decision-contract'
import { assessCeoCuriosity } from './ceo-curiosity'
import type { TaskType } from './subagent-governance'
import { assertCeoEvidenceContractInvariant, deriveEvidenceProfile, normalizeCeoEvidenceContract, extractInstructionWindow } from './ceo-cognitive-contract'
import type { CeoExecutionContract, CeoIntent, EvidenceClass, EvidenceDomain, EvidenceOperation, EvidenceProfile, EvidenceRequirement, ExecutionRequirement, OrchestrationOwner, PreRouteDecision, TemporalScope } from './ceo-cognitive-contract'
import type { CanonicalConversationContext } from './ceo-cognitive-conversation'
import { isRetrospectiveConversationRequest, isContinuationOrRestatementRequest, isBareContinuationOrRestatementRequest, isObjectiveAgreementContinuationRequest, isDemonstrativeContinuationRequest, isObjectiveProgressionRequest, isObjectiveConfirmationSignal, isBareObjectiveConfirmation, CONTEXTUAL_REFERENCE_RE } from './ceo-conversational-signals'
import { enforceContractConsistency } from './ceo-contract-consistency-gate'

const SIMPLE_RE = /^(what is|what's|who is|where is|when is|how much|how many|define|meaning of|translate|calculate)\b/i
// Item 2 of the "make Agent007 feel like Claude" plan: research|search|look up|find out|verify|validate
// (below) already routes an explicit lookup request to evidence acquisition, but real conversational
// phrasing for the same intent is broader than that -- "can you check online for X", "what's the latest
// on Y", "google this for me" never matched, so those turns silently stayed on the no-evidence
// conversation path. Deliberately phrase-based, not single generic verbs: bare "check"/"confirm"/"look
// into" are used constantly in purely internal contexts ("check the budget", "confirm the meeting") and
// would misroute them into an unnecessary external-evidence requirement (added latency, an evidence
// bundle that isn't relevant). Each phrase here specifically names an external/web/current-information
// lookup, the same discipline used for the intent regexes around it.
//
// Deep-audit fix: "current status of" was dropped entirely, and "current (price|news) of" gained a
// negative lookahead for our/my/internal -- verified directly, "current status of X" false-positived on
// ordinary internal status checks ("What is the current status of the deployment/mission/revenue
// pipeline?"), all misrouted to evidenceClass:'external_web' with a live web-search attempt for purely
// internal state. "status" skews internal far more than "price"/"news" do in a business-CEO context and
// has zero existing test coverage requiring it; "price"/"news" kept but excluded when asking about our
// own/internal things ("current price of our subscription plan"), which was the same false-positive
// class.
//
// Deep-audit fix (independently confirmed): bare "check online" false-positived on "check online
// banking for the wire transfer status" / "check online to see if the invoice cleared" -- both about the
// user's own accounts, not a web lookup. "check the web"/"check the internet" are unambiguous on their
// own and unchanged; "check online" now requires "...for" immediately after (a genuine web-search
// directive: "check online for X"), which the internal-account phrasings above don't have.
const EXTERNAL_LOOKUP_PHRASE_RE = /\b(?:check\s+online\s+for|check\s+(?:the\s+web|the\s+internet)|google\s+(?:it|this|that|for\s+me)|fact[- ]check|what'?s\s+the\s+latest\s+(?:on|news|update)|current\s+(?:price|news)\s+of(?!\s+(?:our|my|internal))|look\s+(?:this|that|it)\s+up\s+online)\b/i
// Tier 4 hygiene fix (2026-09-13): delegates to the canonical CONTEXTUAL_REFERENCE_RE
// (ceo-conversational-signals.ts) instead of a locally-drifted word list; see that constant's comment.
const CONTEXT_RE = CONTEXTUAL_REFERENCE_RE
const DIRECT_CEO_MAX_CHARS = 1200
function latestUserText(messages: readonly { role: string; content: string }[]): string { return [...messages].reverse().find((message) => message.role === 'user' && typeof message.content === 'string')?.content ?? '' }

const MARKET_SECURITY_RE = /\b(?:stock(?:s)?|share(?:s)?|equity|ticker|market\s+cap(?:italization)?|valuation|earnings|financials?|price\s+target|p\/e|pe\s+ratio|eps|dividend|cash\s+flow|10-k|10-q|sec\s+filing|invest(?:ing|ment)?|portfolio)\b/i
const MARKET_ACTION_RE = /\b(?:analy[sz]e|analysis|assess|evaluate|compare|research|review|recommend(?:ation)?|should|invest|buy|sell|hold|trade|value|price)\b/i
// Natural-language equity research frequently uses "check/pull/gather + news/information" instead of
// the word "research". Keep the signal contextual so ordinary internal checks are not routed externally.
const MARKET_RESEARCH_LOOKUP_RE = /\b(?:check|pull|gather|collect|find)\b[^.!?]{0,80}\b(?:news|headlines?|relevant\s+information|information|updates?)\b/i
// Production incident (2026-09-17): "give me updates about 2 stocks, GEOS and MIND Technology, in your
// own words" and "...I want a full understanding of 2 stock, GEOS and MIND..., give me the best of the
// best of you" both named two real tickers plus the unambiguous word "stocks", yet fell all the way
// through to plain 'conversation' -- MARKET_ACTION_RE/MARKET_RESEARCH_LOOKUP_RE only recognized an
// analytical verb (analyze/research/compare/...) or a check/pull/gather+news/updates phrasing, never
// the far more common, ordinary way people actually ask for information: give/tell/share/update/brief/
// explain/summarize/describe/"full understanding"/"walk me through"/"let me know". This is at least as
// strong a research signal as the verbs already covered, gated the same way (MARKET_SECURITY_RE must
// also match, and isInternalEquityContext still excludes genuinely internal phrasing below).
const INFO_REQUEST_ACTION_RE = /\b(?:give|tell|share|update|brief|explain|summar(?:i|y)ze|describe|walk\s+(?:me\s+)?through|let\s+me\s+know|full\s+understanding|overview|rundown|breakdown)\b/i
const EXPLICIT_TICKER_RE = /\([A-Z]{1,5}\)/
// Deep-audit fix (2026-09-13): the verb alternation here was case-sensitive with no /i flag, while
// every sibling regex in this file (MARKET_ACTION_RE, EXTERNAL_LOOKUP_PHRASE_RE, etc.) is case-
// insensitive. A sentence-initial "Buy GEOS." (capitalized, as any normal English sentence would be)
// never matched literal lowercase "buy", so it fell through equity-research classification entirely
// and misrouted to plain conversation instead of governed external-evidence handling -- exactly the
// class of bug this file's own header comment warns about. Capitalizing only the alternation (not
// adding a blanket /i flag) is deliberate: [A-Z]{1,5} must stay upper-case-only, since matching a
// lower-case run there would turn this into an unrelated "verb + any short word" detector.
// Concise equity-research form: a user may provide only the research verb plus an uppercase ticker
// (for example, "Research GEOS"). This must be separate from SHORT_TICKER_ACTION_RE because research
// verbs do not imply a trading action. The uppercase-token guard keeps ordinary prose from matching;
// known common acronyms are excluded by the same allowlist used by the trading-action path.
const CONCISE_TICKER_RESEARCH_RE = /\b(?:[Rr]esearch|[Aa]naly[sz]e|[Rr]eview|[Ss]tudy|[Ii]nvestigate|[Ll]ook\s+into)\s+([A-Z]{2,5})\b/
// Contextual ticker-finance form: ordinary requests such as "Tell me about GEOS earnings" or
// "Explain the financials for GEOS" carry an uppercase ticker and unmistakable market-finance language
// but do not use an explicit research verb. Keep this narrow by requiring the ticker to be adjacent to
// a finance term (or "for/of" the ticker) and retain the normal action/information-request gate below.
const CONTEXTUAL_TICKER_FINANCE_RE = /\b(?:([A-Z]{2,5})\s+(?:stock|shares?|earnings|financials?|valuation|price|dividend|eps|filings?|cash\s+flow(?:\s+forecast)?|forecast)|(?:stock|shares?|earnings|financials?|valuation|price|dividend|eps|filings?|cash\s+flow(?:\s+forecast)?)[^.!?]{0,32}\b(?:for|of)\s+([A-Z]{2,5}))\b/
const SHORT_TICKER_ACTION_RE = /\b(?:[Bb]uy|[Ss]ell|[Ii]nvest|[Tt]rade)\s+(?:in\s+)?([A-Z]{1,5})\b/
// A bare imperative purchase command ("Buy API credits.", "Purchase more storage.") at the start of
// the message is a direct action to execute, not a stock-ticker research signal (that's
// SHORT_TICKER_ACTION_RE's job, checked separately and earlier in inferSemanticIntent) and not a
// hedged decision/analysis question ("Should we buy...", "Analyze whether we should buy..." --
// neither starts with the verb, so this anchored-to-start pattern never touches them).
const IMPERATIVE_ACQUIRE_RE = /^(?:buy|purchase|acquire|order)\b/i
const COMMON_ACRONYM_RE = /^(?:AI|API|AWS|CEO|CFO|CIO|CMO|COO|CPA|CFA|CPU|CRM|CTO|CSO|ERP|GPU|HR|HTML|HTTP|HTTPS|ML|RAM|R&D|SaaS|SEC|SDK|SQL|UI|URL|VPN|XML)$/
const COMPANY_ENTITY_RE = /\b(?:Inc\.?|Incorporated|Corp\.?|Corporation|Ltd\.?|Limited)\b/i
const MARKET_PHRASE_RE = /\b(?:stock(?:s)?|share(?:s)?|ticker|market\s+cap(?:italization)?|p\/e|pe\s+ratio|eps|price\s+target|sec\s+filing|invest(?:ing|ment)?|portfolio)\b/i
// Deep-audit fix (2026-09-13): split into a weak, generic-pronoun signal and a strong, unambiguous
// internal-topic signal. "our"/"we"/"us"/"my" alone used to unconditionally block equity-research
// classification, so "Should we buy shares of our competitor?" -- unambiguously about a DIFFERENT
// company's stock -- lost the equity-specific rigor (multi_source evidence, 8 max turns, 120s budget,
// public_equity profile) reserved for isExternalEquityResearch, silently downgrading to generic
// research. The specific internal-operations/finance nouns (spare parts, warehouse, founder, budget,
// etc.) remain an unconditional block -- those are genuinely internal topics regardless of phrasing.
const INTERNAL_PRONOUN_RE = /\b(?:our|we|us|my)\b/i
const INTERNAL_SPECIFIC_TOPIC_RE = /\b(?:internal|spare\s+parts?|inventory|stockroom|warehouse|server|servers|equipment|founder(?:s)?|co-?founder(?:s)?|ownership\s+split|budget|procurement|purchase\s+order|meeting|review\s+meeting|operational|parts?)\b/i
const EXTERNAL_ENTITY_RE = /\b(?:competitor(?:s)?|rival(?:s)?)\b/i
function isInternalEquityContext(text: string): boolean {
  if (INTERNAL_SPECIFIC_TOPIC_RE.test(text)) return true
  return INTERNAL_PRONOUN_RE.test(text) && !EXTERNAL_ENTITY_RE.test(text)
}
const INTERNAL_FINANCE_RE = /\b(?:our|my|internal)?\s*(?:earnings\s+report|financial\s+forecast|financials?|budget|accounts?|bookkeeping|accounting)\b/i
const INTERNAL_OPERATIONS_RE = /\b(?:spare\s+parts?|inventory|stockroom|warehouse|server(?:s)?|equipment|procurement|purchase\s+order|meeting|review\s+meeting|co-?founder(?:s)?|ownership\s+split|cash\s+flow\s+forecast|operations?|operational)\b/i
const TOOL_ACTION_RE = /\b(?:create|delete|edit|update|change|schedule|send|run|execute|fix|hold\s+(?:a|the)?\s*(?:review\s+)?meeting)\b/i

function isExternalEquityResearch(text: string): boolean {
  const tickerAction = text.match(SHORT_TICKER_ACTION_RE)
  if (tickerAction) return !COMMON_ACRONYM_RE.test(tickerAction[1]) && !isInternalEquityContext(text)

  const conciseResearch = text.match(CONCISE_TICKER_RESEARCH_RE)
  if (conciseResearch) return !COMMON_ACRONYM_RE.test(conciseResearch[1]) && !isInternalEquityContext(text)

  const contextualTickerFinance = text.match(CONTEXTUAL_TICKER_FINANCE_RE)
  if (contextualTickerFinance) {
    const ticker = contextualTickerFinance[1] ?? contextualTickerFinance[2]
    const requestAction = MARKET_ACTION_RE.test(text) || MARKET_RESEARCH_LOOKUP_RE.test(text) || INFO_REQUEST_ACTION_RE.test(text)
    if (ticker && requestAction && !COMMON_ACRONYM_RE.test(ticker) && !isInternalEquityContext(text)) return true
  }

  if (!MARKET_SECURITY_RE.test(text)) return false
  if (!MARKET_ACTION_RE.test(text) && !MARKET_RESEARCH_LOOKUP_RE.test(text) && !INFO_REQUEST_ACTION_RE.test(text)) return false
  if (isInternalEquityContext(text)) return false
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
function inferEvidenceOperation(text: string): EvidenceOperation {
  if (/\b(?:would\s+you\s+invest|should\s+i|should\s+we|recommend(?:ation)?|invest(?:ing|ment)?|buy|sell|hold)\b/i.test(text)) return 'recommend'
  if (/\b(?:compare|versus|vs\.?|better|stronger|weaker)\b/i.test(text)) return 'compare'
  if (/\b(?:forecast|project|outlook|future|estimate)\b/i.test(text)) return 'forecast'
  if (/\b(?:verify|validate|confirm|fact[- ]check)\b/i.test(text)) return 'verify'
  if (/\b(?:explain|what\s+is|who\s+is)\b/i.test(text)) return 'explain'
  if (/\b(?:research|look\s+up|find\s+(?:out|information))\b/i.test(text)) return 'research'
  return /\b(?:analy[sz]e|analysis|assess|evaluate|review)\b/i.test(text) ? 'analyze' : 'research'
}
function buildExecutionContract(input: { intent: CeoIntent; selfReflectionKind?: SelfReflectionClassification['kind']; evidenceClass: EvidenceClass; domain: EvidenceDomain; operation: EvidenceOperation; temporalScope: TemporalScope; evidenceProfile: EvidenceProfile; evidenceRequirement: EvidenceRequirement; executionRequirement: ExecutionRequirement; orchestrationOwner: OrchestrationOwner; maxTurns: number; maxRecoveries: number; latencyBudgetMs: number; toolRequired: boolean; subagentsRequired: boolean; reason: string }): CeoExecutionContract {
  const normalized = normalizeCeoEvidenceContract({ ...input })
  assertCeoEvidenceContractInvariant(normalized)
  return normalized
}
function contractFor(input: { intent: CeoIntent; selfReflectionKind?: SelfReflectionClassification['kind']; adaptiveExecutionClass: 'fast' | 'standard' | 'deep' | 'mission'; missionRelevant: boolean; reason: string; evidenceClass?: EvidenceClass; domain?: EvidenceDomain; operation?: EvidenceOperation; temporalScope?: TemporalScope; evidenceProfile?: EvidenceProfile }): CeoExecutionContract {
  const { intent, selfReflectionKind, adaptiveExecutionClass, missionRelevant, reason, evidenceClass = intent === 'conversation' ? 'none' : 'internal_state', domain = intent === 'conversation' ? 'none' : 'internal_operations', operation = intent === 'conversation' ? 'none' : 'analyze', temporalScope = intent === 'conversation' ? 'none' : 'timeless', evidenceProfile = intent === 'conversation' ? 'none' : 'none' } = input
  if (intent === 'self_assessment') return buildExecutionContract({ intent, selfReflectionKind, evidenceClass: 'internal_state', domain: 'internal_operations', operation: 'analyze', temporalScope: 'current', evidenceProfile: 'none', evidenceRequirement: 'internal_state', executionRequirement: 'llm_only', orchestrationOwner: 'ceo_lifecycle', maxTurns: 2, maxRecoveries: 0, latencyBudgetMs: 30000, toolRequired: false, subagentsRequired: false, reason })
  if (intent === 'conversation') return buildExecutionContract({ intent, evidenceClass: 'none', domain: 'none', operation: 'none', temporalScope: 'none', evidenceProfile: 'none', evidenceRequirement: 'none', executionRequirement: 'llm_only', orchestrationOwner: 'ceo_lifecycle', maxTurns: 1, maxRecoveries: 0, latencyBudgetMs: 15000, toolRequired: false, subagentsRequired: false, reason })
  if (intent === 'analysis' || intent === 'opinion' || intent === 'decision') return buildExecutionContract({ intent, evidenceClass, domain, operation, temporalScope, evidenceProfile, evidenceRequirement: evidenceClass === 'external_web' ? 'external_web' : 'none', executionRequirement: evidenceClass === 'external_web' ? 'multi_source' : 'llm_only', orchestrationOwner: 'ceo_lifecycle', maxTurns: adaptiveExecutionClass === 'deep' ? 3 : 1, maxRecoveries: evidenceClass === 'external_web' ? 1 : 0, latencyBudgetMs: evidenceClass === 'external_web' ? 120000 : (adaptiveExecutionClass === 'deep' ? 30000 : 15000), toolRequired: evidenceClass === 'external_web', subagentsRequired: false, reason })
  if (intent === 'production_action') return buildExecutionContract({ intent, evidenceClass: 'internal_state', domain: 'internal_operations', operation: 'verify', temporalScope: 'current', evidenceProfile: 'none', evidenceRequirement: 'live_system', executionRequirement: 'production', orchestrationOwner: 'operational_orchestrator', maxTurns: 6, maxRecoveries: 1, latencyBudgetMs: 60000, toolRequired: true, subagentsRequired: false, reason })
  if (intent === 'research') { const isEquity = domain === 'public_equity'; return buildExecutionContract({ intent, evidenceClass: 'external_web', domain, operation, temporalScope, evidenceProfile, evidenceRequirement: isEquity ? 'multi_source' : 'external_web', executionRequirement: isEquity ? 'multi_source' : 'one_tool', orchestrationOwner: 'ceo_lifecycle', maxTurns: isEquity ? 8 : (adaptiveExecutionClass === 'deep' ? 6 : 4), maxRecoveries: isEquity ? 2 : 1, latencyBudgetMs: isEquity ? 120000 : (adaptiveExecutionClass === 'deep' ? 60000 : 30000), toolRequired: true, subagentsRequired: false, reason }) }
  if (intent === 'tool_action') return buildExecutionContract({ intent, evidenceClass: 'internal_state', domain: 'internal_operations', operation, temporalScope: 'current', evidenceProfile: 'none', evidenceRequirement: 'internal_state', executionRequirement: 'one_tool', orchestrationOwner: 'operational_orchestrator', maxTurns: adaptiveExecutionClass === 'deep' ? 6 : 4, maxRecoveries: 1, latencyBudgetMs: adaptiveExecutionClass === 'deep' ? 60000 : 30000, toolRequired: true, subagentsRequired: false, reason })
  if (missionRelevant || intent === 'mission_action') return buildExecutionContract({ intent: 'mission_action', evidenceClass: 'mixed', domain: 'business_due_diligence', operation: 'decide', temporalScope: 'current', evidenceProfile: 'business_due_diligence', evidenceRequirement: 'multi_source', executionRequirement: 'mission', orchestrationOwner: 'operational_orchestrator', maxTurns: 12, maxRecoveries: 2, latencyBudgetMs: 60000, toolRequired: true, subagentsRequired: true, reason })
  return buildExecutionContract({ intent, evidenceClass, domain, operation, temporalScope, evidenceProfile, evidenceRequirement: evidenceClass === 'external_web' ? 'external_web' : 'none', executionRequirement: evidenceClass === 'external_web' ? 'multi_source' : 'one_tool', orchestrationOwner: evidenceClass === 'external_web' ? 'ceo_lifecycle' : 'operational_orchestrator', maxTurns: adaptiveExecutionClass === 'deep' ? 6 : 4, maxRecoveries: 1, latencyBudgetMs: adaptiveExecutionClass === 'deep' ? 60000 : 30000, toolRequired: evidenceClass === 'external_web' || intent === 'tool_action', subagentsRequired: false, reason })
}
// Deep-audit fix (2026-09-13): a compound message like "Remind me why we chose this approach, then
// deploy it to production." matched isRetrospectiveConversationRequest on its first clause alone and
// returned 'conversation' before the production/mission checks below ever ran, silently swallowing a
// real deploy instruction onto the lowest-scrutiny lane. Only fires for a genuinely multi-clause
// message (split on sentence punctuation or a "then"/"and then"/"next" clause boundary) and only when
// a LATER clause independently carries its own production/mission signal and is not itself a
// retrospective question -- a single-clause retrospective question that happens to mention an action
// word while describing what was chosen ("why did we choose to launch the campaign this way") has no
// second clause to split into, so it is completely unaffected and keeps its original classification.
// Re-audited (2026-09-13): the comma-boundary alternation only recognized "then"/"and then"/"next", so
// "Remind me why we chose this approach, and deploy it now." -- the same swallowed-command shape, just
// joined with a bare "and" -- still didn't split and fell back to 'conversation'. Added bare "and" to
// the alternation (still requires a preceding comma, so it doesn't split an ordinary single-clause "and"
// like "why did we choose this approach and not that one", which has no comma before it).
const CLAUSE_SPLIT_RE = /[.!?;]+|,\s*(?:then|and then|next|and)\s+/i
function findTrailingProductionOrMissionIntent(text: string): 'production_action' | 'mission_action' | undefined {
  const clauses = text.split(CLAUSE_SPLIT_RE).map((clause) => clause.trim()).filter(Boolean)
  if (clauses.length < 2) return undefined
  for (const clause of clauses) {
    if (isRetrospectiveConversationRequest(clause)) continue
    if (/\b(?:deploy|publish|production|ship|launch)\b/i.test(clause)) return 'production_action'
    if (/\b(?:mission|autonom(?:y|ous)|venture|revenue|transaction)\b/i.test(clause) && /\b(?:run|start|execute|manage|launch|create|fix|implement)\b/i.test(clause)) return 'mission_action'
  }
  return undefined
}
function inferSemanticIntent(text: string, selfReflection: SelfReflectionClassification): CeoIntent {
  if (selfReflection.isSelfReflective) return 'self_assessment'
  // Historical/retrospective questions are semantic conversation requests. Resolve them before action, mission, research, or analysis keywords can steal the route.
  if (isRetrospectiveConversationRequest(text)) {
    const trailingIntent = findTrailingProductionOrMissionIntent(text)
    if (trailingIntent) return trailingIntent
    return 'conversation'
  }
  if (/\b(?:deploy|publish|production|ship|launch)\b/i.test(text)) return 'production_action'
  if (/\b(?:mission|autonom(?:y|ous)|venture|revenue|transaction)\b/i.test(text) && /\b(?:run|start|execute|manage|launch|create|fix|implement)\b/i.test(text)) return 'mission_action'
  if (isExternalEquityResearch(text)) return 'research'
  if (/\b(?:research|search|look\s+up|find\s+(?:out|information)|verify|validate)\b/i.test(text) || EXTERNAL_LOOKUP_PHRASE_RE.test(text)) return 'research'
  if (TOOL_ACTION_RE.test(text) || IMPERATIVE_ACQUIRE_RE.test(text)) return 'tool_action'
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
function buildDecision(input: { route: PreRouteDecision['route']; reason: string; missionRelevant: boolean; complexitySignals: number; taskClass?: TaskType; adaptiveExecutionClass: 'fast' | 'standard' | 'deep' | 'mission'; executionContract: CeoExecutionContract }): PreRouteDecision {
  const executionContract = normalizeCeoEvidenceContract(input.executionContract)
  assertCeoEvidenceContractInvariant(executionContract)
  return { ...input, executionContract }
}

function hasSignificantThreadOverlap(message: string, thread: CanonicalConversationContext['state']['threads'][number]): boolean {
  const stopwords = new Set(['about', 'after', 'again', 'because', 'before', 'being', 'between', 'could', 'from', 'have', 'into', 'more', 'most', 'other', 'should', 'that', 'their', 'there', 'these', 'they', 'this', 'those', 'through', 'under', 'what', 'when', 'where', 'which', 'while', 'with', 'would', 'your', 'please', 'then', 'than', 'just', 'like', 'really', 'very', 'doing', 'does', 'dont', 'you', 'are', 'how', 'why', 'can', 'tell', 'give', 'make', 'want', 'were', 'will', 'been', 'them', 'same', 'go', 'ahead', 'continue'])
  const tokens = (value: string) => [...new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 4 && !stopwords.has(token)))]
  const current = new Set(tokens(message))
  // Only the durable thread title is an eligible lexical anchor here. currentObjective may already
  // contain the current turn when conversation state is derived for that same request, which would
  // make any message appear self-relevant and defeat the fail-closed confirmation gate.
  const prior = tokens(thread.title)
  const shared = prior.filter((token) => current.has(token))
  return shared.length >= 2 || shared.some((token) => token.length >= 8)
}

function hasThreadTickerAnchor(message: string, thread: CanonicalConversationContext['state']['threads'][number]): boolean {
  const extract = (value: string) => [...new Set(value.match(/\b[A-Z]{2,5}\b/g) ?? [])].filter((token) => !COMMON_ACRONYM_RE.test(token))
  const currentTickers = new Set(extract(message))
  return extract(thread.title).some((ticker) => currentTickers.has(ticker))
}
function latestContinuableObjective(context?: CanonicalConversationContext): string | undefined {
  if (!context) return undefined
  const current = context.currentMessage.trim()
  const broadContinuation = isContinuationOrRestatementRequest(current)
  const directContinuation =
    isBareContinuationOrRestatementRequest(current)
    || isObjectiveAgreementContinuationRequest(current)
    || isDemonstrativeContinuationRequest(current)
    || isObjectiveProgressionRequest(current)
  const bareConfirmation = isBareObjectiveConfirmation(current)
  const broadConfirmation = isObjectiveConfirmationSignal(current)
  if (!directContinuation && !bareConfirmation && !broadConfirmation) return undefined

  const candidates = context.state.threads
    .filter((thread) => thread.status === 'active' || thread.status === 'paused')
    .sort((a, b) => b.lastTouchedAt - a.lastTouchedAt)
  const thread = candidates[0]
  if (!thread) return undefined

  // A non-bare final-clause confirmation (for example, "..., continue") is only allowed to revive
  // an objective when the current text is anchored to that thread. This prevents a new unrelated
  // request ending with "go ahead"/"continue" from inheriting the previous research/action objective.
  // Bare confirmations remain valid on their own because they carry no competing new task content.
  if (broadContinuation && !directContinuation) {
    const lower = current.toLowerCase()
    const currentTokens = new Set(lower.split(/[^a-z0-9]+/).filter(Boolean))
    const entityAnchor = thread.entities.some((entity) => {
      const entityTokens = entity.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
      return entityTokens.length > 0 && entityTokens.every((token) => currentTokens.has(token))
    })
    const lexicalAnchor = hasSignificantThreadOverlap(current, thread)
    const tickerAnchor = hasThreadTickerAnchor(current, thread)
    const referenceAnchor = context.references.some((reference) =>
      Boolean(reference.resolvedText && !reference.ambiguous && reference.confidence >= 0.55),
    )
    if (!entityAnchor && !referenceAnchor && !lexicalAnchor && !tickerAnchor) return undefined
  }

  // `title` is intentionally stable: buildThreads updates currentObjective as each turn arrives, but
  // the original thread title remains the durable objective anchor. This prevents a confirmation or
  // bounded correction from ending the underlying research/action objective itself.
  const title = thread.title.trim()
  const currentObjective = thread.currentObjective.trim()
  if (!title) return currentObjective || undefined
  if (!currentObjective || currentObjective === title) return title
  return `${title}\n${currentObjective}`
}

// Stage 2 of the CEO Conversation Kernel migration (2026-09-18): decisionContract lets a caller that
// already built the authoritative ConversationDecisionContract for this exact semanticContext (route.ts,
// via composeCeoContext) pass it straight through instead of paying for a second, byte-identical build
// -- this function otherwise rebuilds it below purely to feed curiosity/evidence narrowing, then
// discarded it entirely, which was the other half of the "overlapping decide-stage" this migration
// exists to remove. Omitting it preserves the original self-contained behavior for every other caller
// (tests, offline tooling) that only has semanticContext to hand.
export function preRouteCeoRequest(messages: readonly { role: string; content: string }[], attachmentsCount = 0, semanticContext?: CanonicalConversationContext, decisionContract?: ConversationDecisionContract): PreRouteDecision {
  const text = latestUserText(messages).replace(/\s+/g, ' ').trim()
  // Long-document audit fix (2026-09-19): every keyword classifier this function drives (self-
  // reflection, semantic intent, external-equity/domain detection, evidence operation/temporal-scope
  // inference) used to test the full raw message, including any pasted document -- so a long paste that
  // happened to use ordinary words like "deploy"/"mission"/"analyze"/"verify" anywhere in its body could
  // misroute the entire request, up to and including flipping missionRelevant/orchestrationOwner to the
  // operational orchestrator for a plain document-analysis turn. classificationText bounds every
  // keyword scan below to the user's own plausible instruction; `text` itself is left untouched for
  // length/emptiness checks and structural reference-slicing, and is still what reaches generation
  // downstream (via canonicalSemanticContext.currentMessage, not this file).
  // Recommendation 1 (2026-09-20): prefers semanticContext.instruction (computed once in
  // buildCanonicalConversationContext, the real production path -- see route.ts) over recomputing here.
  // This is not just deduplication: `text` above whitespace-collapses newlines before windowing, which
  // silently disabled extractInstructionWindow's lead-in-phrase branch (it requires a real newline after
  // the phrase) for every call through this file specifically -- semanticContext.instruction is built
  // from the newline-preserving canonical currentMessage, so it doesn't have that gap. Falls back to the
  // original local computation for any caller without a canonical context yet (tests, offline tooling).
  const classificationText = semanticContext?.instruction ?? extractInstructionWindow(text)
  const rawSelfReflection = classifyCeoSelfReflection(classificationText)
  // Source Authority Phase 4: all impossible-state handling is centralized in the reusable gate.
  // The envelope remains the source of truth; the raw classifier supplies only detail.
  const envelope = semanticContext?.turnEnvelope
  const initialConsistency = enforceContractConsistency({
    candidateIntent: rawSelfReflection.isSelfReflective ? 'self_assessment' : 'conversation',
    candidateSelfReflection: rawSelfReflection,
    sourceMaterialPresent: envelope?.sourceMaterial?.present === true,
    authoritativeInstruction: envelope?.instruction.authoritativeText ?? classificationText,
    selfAssessmentRequested: envelope?.selfAssessmentRequested === true,
    requestedOperation: envelope?.requestedOperation ?? 'conversation',
  })
  const selfReflection = initialConsistency.effectiveSelfReflection
  const adaptive = classifyExecution(messages, selfReflection)
  // Source Authority hardening: task classification is a provider-lane hint, but it must not scan arbitrary pasted source vocabulary. The production path supplies the canonical bounded instruction window above.
  const taskClass = inferTaskType([{ role: 'user', content: semanticContext?.turnEnvelope?.instruction.authoritativeText ?? classificationText }])
  // Continuations/confirmations must inherit the active objective before the per-turn LLM-assisted
  // semantic layer gets a chance to collapse a short reference like "yes, go ahead" into conversation.
  // The inherited objective is only used for routing/grounding; the user's actual text remains the
  // response surface and is never replaced or rewritten.
  const inheritedObjective = latestContinuableObjective(semanticContext)
  const routingText = inheritedObjective ? `${inheritedObjective}\n${classificationText}` : classificationText
  const proposedDeterministicIntent = inferSemanticIntent(routingText, selfReflection)
  const consistency = enforceContractConsistency({
    candidateIntent: proposedDeterministicIntent,
    candidateSelfReflection: selfReflection,
    sourceMaterialPresent: envelope?.sourceMaterial?.present === true,
    authoritativeInstruction: envelope?.instruction.authoritativeText ?? classificationText,
    selfAssessmentRequested: envelope?.selfAssessmentRequested === true,
    requestedOperation: envelope?.requestedOperation ?? 'conversation',
  })
  const deterministicIntent = consistency.effectiveIntent
  const assistedIntent = semanticIntentToCeoIntent(semanticContext)
  // Deep-audit fix (2026-09-13): only 'self_assessment' was protected from being overridden by the
  // LLM-assisted intent. ceo-semantic-interpreter.ts's HIGH_RISK_EXECUTION_RE/MISSION_EXECUTION_RE
  // guards already force deterministic-only classification for most deploy/production/mission-bearing
  // messages, but TOOL_ACTION_RE (create/delete/edit/update/change/schedule/send/run/execute/fix) is a
  // materially different word set with no equivalent guard upstream -- "update our pricing strategy
  // across all products" trips TOOL_ACTION_RE deterministically but neither upstream guard, so a
  // confident assisted intentHint of 'decision' could silently replace 'tool_action' before contractFor
  // ever ran, losing its governed toolRequired/executionRequirement entirely (not just downgrading
  // them, as the evidence/tool overwrite below can also do to production_action/mission_action).
  // production_action/mission_action are included here too for defense in depth even though the
  // interpreter-level guard already covers most of their triggering keywords.
  const objectiveContinuationActive = Boolean(inheritedObjective)
  const deterministicExternalResearch = deterministicIntent === 'research' && (isExternalEquityResearch(routingText) || EXTERNAL_LOOKUP_PHRASE_RE.test(classificationText))
  const deterministicIntentIsGoverned = deterministicIntent === 'self_assessment' || deterministicIntent === 'production_action' || deterministicIntent === 'mission_action' || deterministicIntent === 'tool_action' || deterministicExternalResearch
  const proposedSemanticIntent = deterministicIntentIsGoverned ? deterministicIntent : (assistedIntent ?? deterministicIntent)
  const semanticConsistency = enforceContractConsistency({
    candidateIntent: proposedSemanticIntent,
    candidateSelfReflection: selfReflection,
    sourceMaterialPresent: envelope?.sourceMaterial?.present === true,
    authoritativeInstruction: envelope?.instruction.authoritativeText ?? classificationText,
    selfAssessmentRequested: envelope?.selfAssessmentRequested === true,
    requestedOperation: envelope?.requestedOperation ?? 'conversation',
  })
  const semanticIntent = semanticConsistency.effectiveIntent
  const canonicalDecision = semanticContext ? (decisionContract ?? buildConversationDecisionContract(semanticContext)) : undefined
  const curiosity = semanticContext && canonicalDecision ? assessCeoCuriosity(semanticContext, canonicalDecision) : null
  const explicitOperational = semanticIntent === 'production_action' || semanticIntent === 'tool_action' || semanticIntent === 'research' || semanticIntent === 'mission_action'
  const routingExternalSubjectDomain = inferExternalDomain(routingText)
  const currentExternalSubjectDomain = inferExternalDomain(classificationText)
  const externalSubjectDomain = objectiveContinuationActive && routingExternalSubjectDomain === 'public_equity' ? 'public_equity' : currentExternalSubjectDomain
  const inheritedExternalResearch = objectiveContinuationActive && deterministicIntent === 'research' && routingExternalSubjectDomain === 'public_equity'
  const legacyExternalEvidence = isExternalDomain(routingExternalSubjectDomain) && (semanticIntent === 'research' || semanticIntent === 'analysis' || semanticIntent === 'decision' || semanticIntent === 'opinion')
  const canonicalExternalEvidence = Boolean(canonicalDecision && curiosity?.investigate)
  const shouldUseExternalEvidence = inheritedExternalResearch || (semanticContext ? canonicalExternalEvidence : legacyExternalEvidence)
  const evidenceClass: EvidenceClass | undefined = shouldUseExternalEvidence ? 'external_web' : undefined
  const domain: EvidenceDomain | undefined = semanticIntent === 'research' || shouldUseExternalEvidence || externalSubjectDomain.startsWith('internal_') ? externalSubjectDomain : undefined
  const effectiveExecutionClass = (externalSubjectDomain === 'public_equity' || inheritedExternalResearch) ? 'deep' : adaptive.executionClass
  if (!text) { const reason = 'No substantive request detected.'; return buildDecision({ route: 'fast', reason, missionRelevant: false, complexitySignals: 0, taskClass, adaptiveExecutionClass: 'fast', executionContract: contractFor({ intent: 'conversation', adaptiveExecutionClass: 'fast', missionRelevant: false, reason }) }) }
  // Audit fix (2026-09-19): adaptive.executionClass 'mission' is a genuinely loose, tolerated-ambiguous
  // signal -- adaptive-execution.ts's own test suite accepts EITHER 'deep' or 'mission' for a message
  // that merely combines ordinary business vocabulary (revenue/customer/production) with deep-work
  // language ("analyze"/"strategic"/"deep"), since its own return values are identical for both classes.
  // A real long-document analysis request commonly does both (any business report's opening paragraph
  // routinely mentions revenue), so using this signal alone to flip missionRelevant -- and therefore
  // orchestrationOwner to operational_orchestrator via contractFor -- misrouted a plain "give me a deep
  // analysis of this report" request purely because the document discussed revenue. deterministicIntent
  // already ran its own, stricter mission_action check on this exact message (context word AND an actual
  // execution verb -- run/start/execute/manage/launch/create/fix/implement) and correctly declined to
  // classify it as mission-related; that more specific classification should not be overridden by the
  // looser adaptive-execution signal when they disagree.
  const deterministicIntentIsNonMission = deterministicIntent === 'analysis' || deterministicIntent === 'opinion' || deterministicIntent === 'decision' || deterministicIntent === 'conversation' || deterministicIntent === 'self_assessment'
  const missionRelevant = semanticIntent === 'mission_action' || (adaptive.executionClass === 'mission' && !explicitOperational && !deterministicIntentIsNonMission)
  const complexitySignals = [effectiveExecutionClass === 'deep' || effectiveExecutionClass === 'mission', text.length > DIRECT_CEO_MAX_CHARS, /\b(and|then|because|including|with|plus)\b/i.test(text)].filter(Boolean).length
  if (attachmentsCount > 0) { const reason = 'Attachments require contextual inspection and cannot use the direct CEO conversational lane.'; const temporalScope = domain && shouldUseExternalEvidence ? inferTemporalScope(routingText) : undefined; const operation = domain && shouldUseExternalEvidence ? inferEvidenceOperation(routingText) : undefined; const evidenceProfile = domain && shouldUseExternalEvidence ? deriveEvidenceProfile(domain) : undefined; return buildDecision({ route: 'full', reason, missionRelevant, complexitySignals, taskClass, adaptiveExecutionClass: effectiveExecutionClass, executionContract: contractFor({ intent: semanticIntent, selfReflectionKind: selfReflection.kind, adaptiveExecutionClass: effectiveExecutionClass, missionRelevant, reason, ...(evidenceClass ? { evidenceClass } : {}), ...(domain ? { domain } : {}), ...(operation ? { operation } : {}), ...(temporalScope ? { temporalScope } : {}), ...(evidenceProfile ? { evidenceProfile } : {}) }) }) }
  if (semanticIntent === 'self_assessment') { const reason = 'Self-assessment stays CEO-owned and bounded; no operational tools are required.'; return buildDecision({ route: 'fast', reason, missionRelevant: false, complexitySignals, taskClass, adaptiveExecutionClass: 'fast', executionContract: contractFor({ intent: 'self_assessment', selfReflectionKind: selfReflection.kind, adaptiveExecutionClass: 'fast', missionRelevant: false, reason }) }) }
  const temporalScope = domain && shouldUseExternalEvidence ? inferTemporalScope(routingText) : undefined
  const operation = domain && shouldUseExternalEvidence ? inferEvidenceOperation(routingText) : undefined
  const evidenceProfile = domain && shouldUseExternalEvidence ? deriveEvidenceProfile(domain) : undefined
  const executionContract = contractFor({ intent: semanticIntent, adaptiveExecutionClass: effectiveExecutionClass, missionRelevant, reason: curiosity?.reason ?? (inheritedObjective ? 'Continuing the active conversational objective with its governed execution policy.' : 'Canonical semantic routing decision.'), ...(evidenceClass ? { evidenceClass } : {}), ...(domain ? { domain } : {}), ...(operation ? { operation } : {}), ...(temporalScope ? { temporalScope } : {}), ...(evidenceProfile ? { evidenceProfile } : {}) })
  // Deep-audit fix (2026-09-13): this block used to run for every semanticIntent, unconditionally
  // overwriting evidenceClass/evidenceRequirement/toolRequired (and, when canonicalDecision.toolRequirement
  // is 'none', downgrading executionRequirement to 'llm_only') based solely on
  // canonicalDecision.toolRequirement -- a 3-value enum (SemanticIntentHint-derived, 'required'/'possible'/
  // 'none') that has no representation at all for tool_action/production_action/mission_action.
  // contractFor just above already computed intent-specific, correct evidence/tool requirements for
  // exactly those governed action intents (e.g. production_action's 'live_system'/'production').
  // Downstream, buildCeoContextModules's includeOrganization check reads evidenceClass and
  // executionRequirement directly, so this could silently drop the organization-context module from a
  // real production/tool action turn whenever the LLM-assisted semantic layer's coarser judgment
  // disagreed with the deterministic classifier -- a real grounding loss, not just a cosmetic field
  // mismatch. Scoped to only the three action-execution intents -- 'research' deliberately stays
  // covered by this block: it's how curiosity's internal/external judgment narrows a bare-keyword
  // "verify our compliance status" (deterministically 'research' via the bare "verify" match, but
  // actually asking about internal state) down to evidenceClass 'none' instead of contractFor's
  // research-intent default of 'external_web' -- removing 'research' here broke exactly that case.
  const governedByDeterministicIntent = semanticIntent === 'production_action' || semanticIntent === 'tool_action' || semanticIntent === 'mission_action' || deterministicExternalResearch || inheritedExternalResearch
  if (semanticContext && canonicalDecision && !governedByDeterministicIntent) {
    const externallyRequired = curiosity?.investigate === true
    const canonicalToolRequired = canonicalDecision.toolRequirement === 'required'
    executionContract.evidenceClass = externallyRequired ? 'external_web' : 'none'
    executionContract.evidenceRequirement = externallyRequired ? 'external_web' : 'none'
    executionContract.toolRequired = canonicalToolRequired || externallyRequired
    if (!executionContract.toolRequired && canonicalDecision.toolRequirement === 'none') executionContract.executionRequirement = 'llm_only'
  }
  if (semanticIntent === 'research' || evidenceClass === 'external_web') return buildDecision({ route: 'full', reason: curiosity?.reason ?? (inheritedObjective ? 'Continuing the active external-research objective.' : 'External evidence requires governed execution.'), missionRelevant, complexitySignals, taskClass, adaptiveExecutionClass: effectiveExecutionClass, executionContract })
  if (semanticIntent === 'mission_action' || missionRelevant) return buildDecision({ route: 'full', reason: 'Mission-relevant work requires governed orchestration.', missionRelevant, complexitySignals, taskClass, adaptiveExecutionClass: effectiveExecutionClass, executionContract })
  if (semanticIntent === 'tool_action' || semanticIntent === 'production_action') return buildDecision({ route: 'full', reason: 'Operational actions require governed tools.', missionRelevant, complexitySignals, taskClass, adaptiveExecutionClass: effectiveExecutionClass, executionContract })
  // A bare confirmation/continuation cue ("continue", "yes, go ahead") with no continuable thread to
  // attach to has already had its one real routing question answered -- there is nothing to continue --
  // so it should resolve as a plain conversational acknowledgement rather than fall into CONTEXT_RE's
  // generic "this needs richer conversational analysis" ambiguity, which assumes an unresolved
  // antecedent might still be found downstream.
  if (semanticIntent === 'conversation' && !inheritedObjective && semanticContext && isObjectiveConfirmationSignal(text)) { const reason = 'No active objective to continue; treating as a bare conversational acknowledgement.'; return buildDecision({ route: 'fast', reason, missionRelevant: false, complexitySignals, taskClass, adaptiveExecutionClass: 'fast', executionContract: contractFor({ intent: 'conversation', adaptiveExecutionClass: 'fast', missionRelevant: false, reason }) }) }
  const contextMatch = text.match(CONTEXT_RE)
  const hasSelfContainedAntecedent = Boolean(contextMatch && contextMatch.index !== undefined && contextMatch.index >= 30 && /,| and /i.test(text.slice(0, contextMatch.index)))
  if (contextMatch && !SIMPLE_RE.test(text) && !hasSelfContainedAntecedent) { const reason = 'Context-dependent request requires richer conversational analysis.'; return buildDecision({ route: 'ambiguous', reason, missionRelevant, complexitySignals, taskClass, adaptiveExecutionClass: 'standard', executionContract: contractFor({ intent: semanticIntent, adaptiveExecutionClass: 'standard', missionRelevant: false, reason }) }) }
  const useFast = effectiveExecutionClass === 'fast' && (SIMPLE_RE.test(text) || text.length <= DIRECT_CEO_MAX_CHARS)
  return buildDecision({ route: useFast ? 'fast' : 'full', reason: useFast ? 'Bounded direct CEO response.' : 'Complexity/context requires full CEO lifecycle.', missionRelevant, complexitySignals, taskClass, adaptiveExecutionClass: useFast ? 'fast' : effectiveExecutionClass, executionContract })
}
export function resolvePreRoute(decision: PreRouteDecision): 'fast' | 'full' { return decision.route === 'fast' && !decision.executionContract.toolRequired ? 'fast' : 'full' }
