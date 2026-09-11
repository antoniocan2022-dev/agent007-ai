import { listActiveMissionsDB } from './active-missions-db'
import type { ActiveMission, MissionControlEvent } from './active-missions'
import { getSubagentGovernanceProfile, type RiskLevel, type SubagentClass } from './subagent-governance'

export interface LeaderPerformanceRecord {
  leaderId: string
  mandate: { mission: string; class: SubagentClass; riskLevel: RiskLevel } | null
  missionsInvolved: number
  stagesAdvanced: number
  retries: number
  escalations: number
  timesReplaced: number
  // stagesAdvanced / (stagesAdvanced + escalations + timesReplaced); 0 with no resolved outcomes
  // yet, never treated as a penalty -- an untested leader is unproven, not unreliable.
  reliabilityScore: number
  lastActiveAt: string | null
}

// mission-supervisor.ts's own control-event schema is inconsistent: DELEGATION/RETRY/ESCALATION/
// STAGE_ADVANCE events carry a clean leader id in fromLeader/toLeader (e.g. 'aurora'), but REPLAN
// events (built in applySafeReplan) carry a composite "id/DisplayName" string (e.g.
// 'aurora/Aurora') instead. This extracts the id portion either way rather than mis-keying REPLAN
// events under the composite string.
function extractLeaderId(value: string | null): string | null {
  if (!value) return null
  const slash = value.indexOf('/')
  return slash === -1 ? value : value.slice(0, slash)
}

function emptyRecord(leaderId: string): LeaderPerformanceRecord {
  const profile = getSubagentGovernanceProfile(leaderId)
  return {
    leaderId,
    mandate: profile ? { mission: profile.mission, class: profile.class, riskLevel: profile.riskLevel } : null,
    missionsInvolved: 0,
    stagesAdvanced: 0,
    retries: 0,
    escalations: 0,
    timesReplaced: 0,
    reliabilityScore: 0,
    lastActiveAt: null,
  }
}

function recordFor(records: Map<string, LeaderPerformanceRecord>, missionsByLeader: Map<string, Set<string>>, leaderId: string, missionId: string): LeaderPerformanceRecord {
  if (!records.has(leaderId)) records.set(leaderId, emptyRecord(leaderId))
  if (!missionsByLeader.has(leaderId)) missionsByLeader.set(leaderId, new Set())
  missionsByLeader.get(leaderId)!.add(missionId)
  return records.get(leaderId)!
}

function touchLastActive(record: LeaderPerformanceRecord, timestamp: string): void {
  if (!record.lastActiveAt || timestamp > record.lastActiveAt) record.lastActiveAt = timestamp
}

function applyEvent(records: Map<string, LeaderPerformanceRecord>, missionsByLeader: Map<string, Set<string>>, missionId: string, event: MissionControlEvent): void {
  const fromLeader = extractLeaderId(event.fromLeader)
  const toLeader = extractLeaderId(event.toLeader)
  if (event.type === 'STAGE_ADVANCE' && fromLeader) { const record = recordFor(records, missionsByLeader, fromLeader, missionId); record.stagesAdvanced++; touchLastActive(record, event.timestamp) }
  if (event.type === 'RETRY' && toLeader) { const record = recordFor(records, missionsByLeader, toLeader, missionId); record.retries++; touchLastActive(record, event.timestamp) }
  if (event.type === 'ESCALATION' && fromLeader) { const record = recordFor(records, missionsByLeader, fromLeader, missionId); record.escalations++; touchLastActive(record, event.timestamp) }
  if (event.type === 'REPLAN' && fromLeader) { const record = recordFor(records, missionsByLeader, fromLeader, missionId); record.timesReplaced++; touchLastActive(record, event.timestamp) }
  if (event.type === 'DELEGATION' && toLeader) { const record = recordFor(records, missionsByLeader, toLeader, missionId); touchLastActive(record, event.timestamp) }
}

// Real, persistent cross-mission leadership record -- mission-supervisor.ts's own MissionSupervisorState
// resets per mission (keyed by ownerId:missionId), so a leader's track record was invisible the moment
// one mission ended. This instead folds every mission's already-recorded control events (real signals
// already written by mission-supervisor.ts, not new instrumentation) into one ledger per leader.
export async function getLeadershipPerformanceLedger(ownerId: string, preloadedMissions?: readonly ActiveMission[]): Promise<LeaderPerformanceRecord[]> {
  const missions = preloadedMissions ?? await listActiveMissionsDB(ownerId)
  const records = new Map<string, LeaderPerformanceRecord>()
  const missionsByLeader = new Map<string, Set<string>>()
  for (const mission of missions) for (const event of mission.controlEvents ?? []) applyEvent(records, missionsByLeader, mission.id, event)
  for (const [leaderId, record] of records) {
    record.missionsInvolved = missionsByLeader.get(leaderId)?.size ?? 0
    const resolvedOutcomes = record.stagesAdvanced + record.escalations + record.timesReplaced
    record.reliabilityScore = resolvedOutcomes > 0 ? Number((record.stagesAdvanced / resolvedOutcomes).toFixed(3)) : 0
  }
  return [...records.values()].sort((a, b) => b.reliabilityScore - a.reliabilityScore || b.missionsInvolved - a.missionsInvolved)
}

export async function getLeaderPerformanceRecord(ownerId: string, leaderId: string): Promise<LeaderPerformanceRecord> {
  const ledger = await getLeadershipPerformanceLedger(ownerId)
  return ledger.find((record) => record.leaderId === leaderId) ?? emptyRecord(leaderId)
}

export function renderLeadershipPerformanceContext(ledger: readonly LeaderPerformanceRecord[]): string {
  if (!ledger.length) return 'No cross-mission leadership performance history recorded yet.'
  const lines = ledger
    .slice(0, 10)
    .map((record) => `${record.leaderId} (${record.mandate?.class ?? 'unmandated'}): ${record.missionsInvolved} mission(s), ${record.stagesAdvanced} stage(s) advanced, ${record.retries} retr(y/ies), ${record.escalations} escalation(s), ${record.timesReplaced} replacement(s), reliability ${(record.reliabilityScore * 100).toFixed(0)}%`)
  return lines.join('\n')
}
