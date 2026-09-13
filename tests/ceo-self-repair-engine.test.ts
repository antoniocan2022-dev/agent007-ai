import { afterEach, describe, expect, test } from 'bun:test'
import {
  __setLearnedCapabilityPatternForTest,
  approveSelfRepairPattern,
  buildPatternSourceFromPhrase,
  clusterIncidentCandidates,
  extractCandidatePhrase,
  getLearnedCapabilityPattern,
  rejectSelfRepairPattern,
  runGovernedSelfRepairCycle,
  SELF_REPAIR_SAFE_NEGATIVES,
  validateProposedPattern,
} from '@/lib/ceo-self-repair-engine'
import { classifyCeoSelfReflection } from '@/lib/ceo-self-reflection'
import type { IncidentRegressionCandidate } from '@/lib/ceo-incident-regression-candidate'

// __setLearnedCapabilityPatternForTest mutates process-wide module state (the same cache
// ceo-self-reflection.ts's hot classification path reads from), so every test that touches it must
// reset to null afterward -- otherwise a learned pattern set here would leak into
// tests/ceo-self-reflection.test.ts's assertions depending on file execution order within the same
// bun test process.
afterEach(() => { __setLearnedCapabilityPatternForTest(null) })

function candidate(overrides: Partial<IncidentRegressionCandidate>): IncidentRegressionCandidate {
  return {
    schemaVersion: 1,
    fingerprint: overrides.fingerprint ?? `fp-${Math.random().toString(36).slice(2, 8)}`,
    invariant: 'test invariant',
    inputClass: overrides.inputClass ?? 'self_assessment',
    message: overrides.message ?? 'test message',
    observedIntent: 'conversation',
    observedSpeechAct: 'question',
    observedAction: 'answer',
    status: 'candidate',
    domain: overrides.domain,
  }
}

describe('P0: incident clustering (pure)', () => {
  test('groups by (inputClass, domain) and dedups messages and fingerprints', () => {
    const candidates = [
      candidate({ inputClass: 'self_assessment', message: 'what can I do to give you access?', fingerprint: 'a' }),
      candidate({ inputClass: 'self_assessment', message: 'what can I do to give you access?', fingerprint: 'a' }),
      candidate({ inputClass: 'self_assessment', message: 'how can I give you access to more data?', fingerprint: 'b' }),
      candidate({ inputClass: 'confusion', message: 'i dont understand', fingerprint: 'c' }),
    ]
    const clusters = clusterIncidentCandidates(candidates)
    expect(clusters.length).toBe(2)
    const selfAssessment = clusters.find((cluster) => cluster.inputClass === 'self_assessment')!
    expect(selfAssessment.messages.length).toBe(2)
    expect(selfAssessment.fingerprints).toEqual(['a', 'b'])
  })

  test('separates the same inputClass by domain', () => {
    const candidates = [
      candidate({ inputClass: 'self_assessment', domain: 'public_equity', message: 'msg1' }),
      candidate({ inputClass: 'self_assessment', domain: undefined, message: 'msg2' }),
    ]
    expect(clusterIncidentCandidates(candidates).length).toBe(2)
  })
})

describe('P0: candidate phrase extraction (pure, no I/O)', () => {
  test('finds the longest shared phrase across recurring messages', () => {
    const phrase = extractCandidatePhrase([
      'tell me what can I do to give you access to live information',
      'How can I give you access to more data',
      'how do I give you access to a new source',
    ])
    expect(phrase).toBe('i give you access to')
  })

  test('returns null when there are fewer distinct messages than minSupport', () => {
    expect(extractCandidatePhrase(['only one message'], 2)).toBeNull()
  })

  test('returns null when no phrase of sufficient length is shared', () => {
    expect(extractCandidatePhrase(['completely unrelated text here', 'another sentence about something else'], 2)).toBeNull()
  })

  test('duplicate identical messages do not count as separate support', () => {
    expect(extractCandidatePhrase(['give you access to this', 'give you access to this'], 2)).toBeNull()
  })
})

describe('P0: pattern construction (pure)', () => {
  // extractCandidatePhrase only ever produces plain, tokenized (alphanumeric-only) words, so this
  // exercises that realistic contract rather than punctuation buildPatternSourceFromPhrase never
  // actually receives from the pipeline.
  test('produces a working, case-insensitive, whitespace-flexible whole-phrase regex', () => {
    const regex = new RegExp(buildPatternSourceFromPhrase('give you access'), 'i')
    expect(regex.test('please GIVE  YOU   access now')).toBe(true)
    expect(regex.test('giveyouaccess')).toBe(false)
  })
})

describe('P0: pattern validation (pure) -- the safety net that failed once and must not fail again', () => {
  test('accepts a pattern that covers the recurring cases and matches no known-safe negative', () => {
    const patternSource = buildPatternSourceFromPhrase('give you access')
    const result = validateProposedPattern({
      patternSource,
      supportingMessages: ['what can I do to give you access to live data', 'how can I give you access to more sources'],
    })
    expect(result.ok).toBe(true)
    expect(result.matchedSupportCount).toBe(2)
    expect(result.matchedNegativeCount).toBe(0)
  })

  test('rejects a pattern that does not actually cover the reported recurring cases', () => {
    const result = validateProposedPattern({ patternSource: 'totally unrelated phrase', supportingMessages: ['what can I do to give you access to live data', 'how can I give you access to more sources'] })
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('only matches')
  })

  // This is the literal, original GRANT_ACCESS_RE from before the PR #148 review fix -- broad enough to
  // match "give/grant/enable/provide you" with any object at all, not just an access-related one. If
  // this validator would have caught it then, it proves the autonomous path is held to a real bar, not
  // a rubber stamp.
  test('rejects the exact overly-broad pattern found in the PR #148 independent review', () => {
    const originalBuggyPattern = '\\b(?:what|how)\\s+(?:can|do|could|would)\\s+i\\s+(?:do\\s+to\\s+)?(?:give|grant|enable|provide|hook\\s+up|connect)\\s+you\\b'
    const result = validateProposedPattern({
      patternSource: originalBuggyPattern,
      supportingMessages: ['what can I do to give you access to live information', 'how can I give you access to more data'],
    })
    expect(result.ok).toBe(false)
    expect(result.matchedNegativeCount).toBeGreaterThan(0)
    expect(result.reason).toContain('known-safe negative')
  })

  test('the known-safe negative corpus includes the real production incidents this session found', () => {
    expect(SELF_REPAIR_SAFE_NEGATIVES.some((text) => text.includes('give you the numbers'))).toBe(true)
    expect(SELF_REPAIR_SAFE_NEGATIVES.some((text) => text.includes('GEOS'))).toBe(true)
    expect(SELF_REPAIR_SAFE_NEGATIVES.length).toBeGreaterThan(10)
  })
})

describe('P0: learned-pattern cache and the read-side classifier hook', () => {
  test('defaults to null -- classification is unchanged until something has actually been learned', () => {
    expect(getLearnedCapabilityPattern()).toBeNull()
    expect(classifyCeoSelfReflection('give you access to a brand new proprietary telemetry feed').isSelfReflective).toBe(false)
  })

  test('once a pattern is learned, the classifier recognizes it -- additively, without touching the base regex', () => {
    __setLearnedCapabilityPatternForTest(new RegExp(buildPatternSourceFromPhrase('give you access to a brand new'), 'i'))
    const result = classifyCeoSelfReflection('please give you access to a brand new proprietary telemetry feed, how would that work?')
    expect(result.kind).toBe('capability_assessment')
    expect(result.reason).toContain('learned')
  })

  test('a learned pattern can never override the higher-precedence operational/research gate', () => {
    __setLearnedCapabilityPatternForTest(new RegExp(buildPatternSourceFromPhrase('give you access to'), 'i'))
    // "Research" trips RESEARCH_RE, which this file's own precedence order checks before any
    // capability pattern (learned or hardcoded) ever gets a chance to match.
    const result = classifyCeoSelfReflection('Research how to give you access to the new market data feed.')
    expect(result.kind).toBe('none')
    expect(result.isSelfReflective).toBe(false)
  })
})

describe('P0: orchestration and human-approval surface fail open without a live database', () => {
  test('runGovernedSelfRepairCycle never throws and returns the empty-report shape when the database is unreachable', async () => {
    const report = await runGovernedSelfRepairCycle()
    expect(report.scannedCandidates).toBe(0)
    expect(report.autoActivated).toEqual([])
    expect(report.awaitingApproval).toEqual([])
    expect(report.skipped).toEqual([])
  })

  test('approveSelfRepairPattern reports "not found" rather than crashing on an unreachable database', async () => {
    await expect(approveSelfRepairPattern('nonexistent-pattern-id', 'owner@example.com', 'test approval')).rejects.toThrow(/not found/i)
  })

  test('rejectSelfRepairPattern reports "not found" rather than crashing on an unreachable database', async () => {
    await expect(rejectSelfRepairPattern('nonexistent-pattern-id', 'owner@example.com', 'test rejection')).rejects.toThrow(/not found/i)
  })

  test('approveSelfRepairPattern requires a non-empty approver and reason', async () => {
    await expect(approveSelfRepairPattern('some-id', '', 'reason')).rejects.toThrow(/approver and a reason/i)
    await expect(approveSelfRepairPattern('some-id', 'owner@example.com', '')).rejects.toThrow(/approver and a reason/i)
  })
})
