import type { VerificationTier } from './subagent-governance'

export type DecisionGate = 'PASS' | 'BLOCK'

export type CeoDecisionKernelInput = {
  missionId: string
  objective: string
  artifactGatePassed: boolean
  verificationDecision: 'PASS' | 'CHALLENGE' | 'FAIL'
  evidenceCount: number
  criticalConflictCount?: number
  protectedActionRequested?: boolean
  verificationTier?: VerificationTier
}

export type CeoDecisionKernelResult = {
  decision: 'PROCEED' | 'HOLD' | 'REJECT'
  confidence: number
  gates: {
    evidence: DecisionGate
    artifact: DecisionGate
    verification: DecisionGate
    governance: DecisionGate
  }
  rationale: string[]
  nextAction: 'EXECUTE' | 'COLLECT_EVIDENCE' | 'REMEDIATE'
}

/** Deterministic governance around the LLM CEO. The model cannot override these gates. */
export function evaluateCeoDecision(input: CeoDecisionKernelInput): CeoDecisionKernelResult {
  const evidencePass = input.evidenceCount > 0 && (input.criticalConflictCount ?? 0) === 0
  const artifactPass = input.artifactGatePassed
  const verificationPass = input.verificationDecision === 'PASS'
  const governancePass = !input.protectedActionRequested
  const passed = [evidencePass, artifactPass, verificationPass, governancePass].filter(Boolean).length
  const confidence = Math.round((passed / 4) * 100)
  const rationale: string[] = []

  if (!evidencePass) rationale.push('Required evidence is missing or contains unresolved critical conflicts.')
  if (!artifactPass) rationale.push('Required artifacts are missing or not verified.')
  if (!verificationPass) rationale.push(`Verification Officer decision is ${input.verificationDecision}.`)
  if (!governancePass) rationale.push('Protected action requires explicit owner authorization before execution.')
  if (rationale.length === 0) rationale.push('All mandatory executive gates passed.')

  if (evidencePass && artifactPass && verificationPass && governancePass) {
    return {
      decision: 'PROCEED',
      confidence,
      gates: { evidence: 'PASS', artifact: 'PASS', verification: 'PASS', governance: 'PASS' },
      rationale,
      nextAction: 'EXECUTE',
    }
  }

  const hardFailure = input.verificationDecision === 'FAIL' || (input.criticalConflictCount ?? 0) > 0
  return {
    decision: hardFailure ? 'REJECT' : 'HOLD',
    confidence,
    gates: {
      evidence: evidencePass ? 'PASS' : 'BLOCK',
      artifact: artifactPass ? 'PASS' : 'BLOCK',
      verification: verificationPass ? 'PASS' : 'BLOCK',
      governance: governancePass ? 'PASS' : 'BLOCK',
    },
    rationale,
    nextAction: hardFailure ? 'REMEDIATE' : 'COLLECT_EVIDENCE',
  }
}
