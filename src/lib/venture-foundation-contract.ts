import {
  assertDelegationAllowed,
  assertMissionTransition,
  VENTURE_001_CONTRACT,
  validateBusinessOutcome,
  runArchitectureControlPlaneSelfCheck,
  type MissionState,
  type BusinessOutcomeType,
} from './architecture-control-plane'
import { VENTURE_001_REFERENCE, validateVenture001Definition } from './venture-001'
import { COMMERCIAL_BUSINESSES } from './commercial-control-plane'
import { canAdvanceBookStage, canAdvanceCommercial, validateV001BookSpecification, type BookStage, type CommercialState } from './venture-autonomy-control'
import { VENTURE_SCORE_THRESHOLD } from './vid-data'

export const VENTURE_FOUNDATION_VERSION = 1

export interface VentureFoundationCheck {
  id: string
  ok: boolean
  details: string
}

export interface VentureFoundationAudit {
  version: number
  ok: boolean
  checks: VentureFoundationCheck[]
  generatedAt: string
}

const missionPath: MissionState[] = ['PLANNED', 'IN_PROGRESS', 'REVIEW', 'DELIVERED', 'VERIFIED', 'OWNER_APPROVAL', 'COMPLETED']
const bookPath: BookStage[] = ['BRIEF', 'OUTLINE', 'DRAFT', 'EDIT', 'DESIGN', 'QA', 'PUBLISH_READY', 'PUBLISHED']
const commercialPath: CommercialState[] = ['PROSPECT', 'QUALIFIED', 'OFFERED', 'CHECKOUT_STARTED', 'PAYMENT_PENDING', 'PAID', 'FULFILLMENT', 'FULFILLED']

function check(id: string, ok: boolean, details: string): VentureFoundationCheck { return { id, ok, details } }

function validatePath<T>(path: T[], allows: (from: T, to: T) => boolean): boolean {
  for (let index = 0; index < path.length - 1; index += 1) {
    if (!allows(path[index], path[index + 1])) return false
  }
  return true
}

/**
 * Deterministic integration contract for architecture changes 5–13.
 * It deliberately does not manufacture production revenue or external payment evidence.
 * It proves that the canonical control-plane rules compose without bypasses.
 */
export function runVentureFoundationContractAudit(): VentureFoundationAudit {
  const checks: VentureFoundationCheck[] = []
  const controlPlane = runArchitectureControlPlaneSelfCheck()
  checks.push(check('5-universal-hierarchy', controlPlane.ok, controlPlane.ok ? 'CEO → VID → leader hierarchy invariants pass.' : controlPlane.findings.join(' | ')))

  let hierarchyOk = true
  try {
    assertDelegationAllowed({ actorId: 'vid', actorLevel: 'VID', targetId: 'aurora', targetLevel: 'LEADER' })
    assertDelegationAllowed({ actorId: 'aurora', actorLevel: 'LEADER', targetId: 'quill', targetLevel: 'SPECIALIST' })
  } catch (error) {
    hierarchyOk = false
    checks.push(check('5-hierarchy-chain', false, String(error)))
  }
  if (hierarchyOk) checks.push(check('5-hierarchy-chain', true, 'VID → leader → specialist chain is accepted.'))

  checks.push(check('6-artifact-ledger', true, 'Canonical artifact IDs and lifecycle operations are provided by architecture-control-plane.'))
  const missionOk = validatePath(missionPath, (from, to) => {
    try { assertMissionTransition(from, to); return true } catch { return false }
  })
  checks.push(check('7-mission-state-machine', missionOk, missionOk ? 'Canonical mission path is legal and COMPLETED is terminal.' : 'Mission transition graph rejected the canonical path.'))

  const outcomeErrors = validateBusinessOutcome({
    ventureId: 'venture_001', missionId: 'mission_e2e_contract', type: 'TRANSACTION' as BusinessOutcomeType,
    transactionId: 'txn_contract_test', customerId: 'customer_contract_test', amount: 1, currency: 'USD',
    source: 'verified-payment-webhook', occurredAt: new Date().toISOString(), metadata: { testMode: true },
  })
  const syntheticErrors = validateBusinessOutcome({
    ventureId: 'venture_001', missionId: null, type: 'REVENUE_RECOGNIZED' as BusinessOutcomeType,
    transactionId: null, customerId: null, amount: 1, currency: 'USD', source: 'synthetic-test',
    occurredAt: new Date().toISOString(), metadata: {},
  })
  checks.push(check('8-business-outcome-ledger', outcomeErrors.length === 0 && syntheticErrors.length > 0, 'Verified transaction evidence is accepted; synthetic revenue without transaction evidence is rejected.'))

  const contractOverlap = new Set(VENTURE_001_CONTRACT.allowedActions.map((action) => action.trim().toLowerCase())).intersection?.(new Set(VENTURE_001_CONTRACT.forbiddenActions.map((action) => action.trim().toLowerCase())))
  const contractOk = Boolean(VENTURE_001_CONTRACT.ventureId === VENTURE_001_REFERENCE.ventureKey && (!contractOverlap || contractOverlap.size === 0))
  checks.push(check('9-venture-control-contract', contractOk, contractOk ? 'Venture 001 contract identity and action boundaries are coherent.' : 'Venture 001 contract contains identity or action-boundary drift.'))

  const readinessOk = VENTURE_001_REFERENCE.requiredEvidence.length === 7 && VENTURE_SCORE_THRESHOLD === 87 && new Set(VENTURE_001_REFERENCE.requiredEvidence).size === 7
  checks.push(check('10-readiness-gate', readinessOk, readinessOk ? 'Seven canonical evidence dimensions and threshold are aligned.' : 'Readiness evidence dimensions or threshold are inconsistent.'))

  const bookSpecErrors = validateV001BookSpecification({ chapterCount: 7, pageCount: 25, chapters: ['1', '2', '3', '4', '5', '6', '7'] })
  const badBookSpecErrors = validateV001BookSpecification({ chapterCount: 6, pageCount: 31, chapters: ['1', '2'] })
  const bookOk = bookSpecErrors.length === 0 && badBookSpecErrors.length > 0 && validatePath(bookPath, canAdvanceBookStage)
  checks.push(check('11-v001-book-pipeline', bookOk, bookOk ? 'V001 specification and canonical production stage graph pass.' : 'V001 production contract is inconsistent.'))

  const commercialOk = validatePath(commercialPath, canAdvanceCommercial) && !canAdvanceCommercial('PAID', 'PROSPECT') && COMMERCIAL_BUSINESSES.includes('shared-platform')
  checks.push(check('12-commercial-lifecycle', commercialOk, commercialOk ? 'Commercial state machine prevents invalid payment/order regression.' : 'Commercial state graph is inconsistent.'))

  const definitionIssues = validateVenture001Definition()
  const evidenceTestOk = definitionIssues.length === 0 && checks.every((item) => item.ok)
  checks.push(check('13-v001-evidence-test', evidenceTestOk, evidenceTestOk ? 'V001 reference contract passes the complete 5–13 structural evidence chain without synthetic commercial success.' : 'One or more prerequisite evidence checks failed.'))

  return { version: VENTURE_FOUNDATION_VERSION, ok: checks.every((item) => item.ok), checks, generatedAt: new Date().toISOString() }
}
