import type { ConversationDecisionContract } from './ceo-conversation-decision-contract'
import type { CeoWorldModel } from './ceo-world-model'

export type GuardianRiskCategory = 'compliance' | 'security' | 'resource' | 'reputation' | 'data' | 'mission_drift' | 'irreversibility'
export interface GuardianRisk { category: GuardianRiskCategory; severity: 'low' | 'medium' | 'high'; description: string }
export interface GuardianAssessment {
  schemaVersion: 1
  risks: GuardianRisk[]
  shouldDisagree: boolean
  disagreementReason?: string
  safeToProceed: boolean
}

// Deliberately concrete, common patterns rather than an attempt at general risk reasoning --
// the same discipline established throughout this session for every heuristic in this codebase.
const RISK_SIGNALS: Array<{ category: GuardianRiskCategory; pattern: RegExp; severity: 'low' | 'medium' | 'high'; description: string }> = [
  { category: 'compliance', pattern: /\b(?:skip|bypass|ignore|without)\b.{0,30}\b(?:compliance|regulatory|regulation|legal review|audit)\b/i, severity: 'high', description: 'The request proposes bypassing compliance or regulatory review.' },
  { category: 'security', pattern: /\b(?:skip|bypass|disable|ignore|without)\b.{0,30}\b(?:security|auth(?:entication|orization)?|encryption|access control)\b/i, severity: 'high', description: 'The request proposes bypassing security or access controls.' },
  { category: 'irreversibility', pattern: /\b(?:delete|remove|wipe|drop|destroy)\b.{0,30}\b(?:production|database|all|permanently)\b/i, severity: 'high', description: 'The request proposes an irreversible, high-impact action.' },
  { category: 'resource', pattern: /\b(?:spend|commit|allocate)\b.{0,30}\b(?:all|entire|everything|maximum)\b.{0,20}\b(?:budget|resources|funds|capital)\b/i, severity: 'medium', description: 'The request proposes committing all available resources at once.' },
  { category: 'mission_drift', pattern: /\b(?:just copy|blindly follow|do (?:exactly|whatever) (?:what|our competitor)|copy(?:ing)? (?:our |the )?competitor)\b/i, severity: 'medium', description: 'The request proposes copying a competitor rather than a reasoned, differentiated strategy.' },
  { category: 'data', pattern: /\b(?:share|send|export|expose)\b.{0,30}\b(?:customer|user|personal|confidential|private)\b.{0,20}\b(?:data|information|records)\b/i, severity: 'high', description: 'The request involves sharing or exposing sensitive data.' },
]

export function assessGuardianRisk(input: { objective: string; contract: ConversationDecisionContract; world?: CeoWorldModel }): GuardianAssessment {
  const openLoopText = (input.world?.conversation.data.openLoops ?? []).join(' ')
  const text = `${input.objective} ${openLoopText}`
  const risks = RISK_SIGNALS.filter((signal) => signal.pattern.test(text)).map((signal) => ({ category: signal.category, severity: signal.severity, description: signal.description }))
  const highSeverity = risks.filter((risk) => risk.severity === 'high')
  const shouldDisagree = highSeverity.length > 0
  return {
    schemaVersion: 1,
    risks,
    shouldDisagree,
    disagreementReason: shouldDisagree ? highSeverity[0]!.description : undefined,
    safeToProceed: highSeverity.length === 0,
  }
}

// Guardian must be able to disagree without becoming obstructive: this produces a natural,
// respectful pushback instruction, not a refusal -- the CEO still engages with the underlying
// request, just names the risk honestly rather than silently proceeding or silently complying.
export function renderGuardianConstraint(assessment: GuardianAssessment): string | null {
  if (!assessment.shouldDisagree) return null
  return `Before proceeding, name this risk honestly and respectfully: ${assessment.disagreementReason} Do not simply comply or silently ignore this -- explain the concern in plain language and suggest what would need to be resolved first, the way a good business partner would push back rather than a compliance system refusing outright.`
}
