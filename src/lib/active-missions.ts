import { assertMissionTransition, buildArtifactId, registerArtifact, verifyArtifact } from './architecture-control-plane'
/**
 * active-missions.ts — mission domain model and stage state machine.
 * Durable production state is persisted by active-missions-db.ts.
 */
export type MissionStage = 'PLANNED' | 'IN_PROGRESS' | 'REVIEW' | 'DELIVERED' | 'VERIFIED' | 'OWNER_APPROVAL' | 'COMPLETED'
export const STAGE_ORDER: MissionStage[] = ['PLANNED','IN_PROGRESS','REVIEW','DELIVERED','VERIFIED','OWNER_APPROVAL','COMPLETED']
export interface StageHandoff {
  stage: MissionStage
  team: string
  leader: string
  status: 'pending' | 'active' | 'done' | 'blocked'
  startedAt: string | null
  completedAt: string | null
  notes: string
  artifacts: string[]
  artifactRequired: ArtifactType
  artifactValue: string | null
  artifactVerified: boolean
  artifactVerifiedAt: string | null
  artifactVerifyError: string | null
}
export type ArtifactType = 'url' | 'transaction_id' | 'message_id' | 'file_path' | 'data' | 'none'
export interface MissionLogEntry { timestamp: string; actor: string; stage: MissionStage; message: string }
export interface ActiveMission {
  id: string
  /** Canonical authenticated owner identity. Legacy in-memory demo records are unassigned. */
  ownerId: string | null
  title: string
  description: string
  revenueTarget: number
  createdAt: string
  updatedAt: string
  currentStage: MissionStage
  priority: 'low' | 'medium' | 'high' | 'critical'
  category: string
  chain: StageHandoff[]
  log: MissionLogEntry[]
  threads: LeaderThread[]
}
export interface LeaderThread { id: string; missionId: string; leaderId: string; leaderName: string; stage: MissionStage; messages: LeaderMessage[] }
export interface LeaderMessage { id: string; from: 'OWNER' | 'LEADER'; author: string; text: string; timestamp: string }
const POD_LEADERS: Record<string, { leader: string; name: string }> = {
  scout: { leader: 'SCOUT', name: 'Intelligence & Research' },
  aurora: { leader: 'AURORA', name: 'Creation & Design' },
  echo: { leader: 'ECHO', name: 'Quality Assurance' },
  forge: { leader: 'FORGE', name: 'Engineering' },
  pulse: { leader: 'PULSE', name: 'Monitoring & Ops' },
  developer: { leader: 'Developer', name: 'System Health' },
  cybersecurity_r: { leader: 'Cybersecurity R', name: 'Compliance & Security' },
  revenue: { leader: 'QUANTUM + AURORA', name: 'Revenue (Passive Income)' },
}
export const DEFAULT_CHAIN: Array<{ stage: MissionStage; team: string; artifact: ArtifactType }> = [
  { stage: 'PLANNED', team: 'scout', artifact: 'data' },
  { stage: 'IN_PROGRESS', team: 'aurora', artifact: 'url' },
  { stage: 'REVIEW', team: 'echo', artifact: 'data' },
  { stage: 'DELIVERED', team: 'forge', artifact: 'url' },
  { stage: 'VERIFIED', team: 'pulse', artifact: 'data' },
  { stage: 'OWNER_APPROVAL', team: 'pulse', artifact: 'none' },
  { stage: 'COMPLETED', team: 'pulse', artifact: 'none' },
]
let store: ActiveMission[] = []
let seeded = false
const nowIso = () => new Date().toISOString()
const uid = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
const SEED_MISSION_IDS = ['mission_seed_affiliate_blog','mission_seed_saas_pdf_annotator','mission_seed_trading_stablecoin']
function buildChain(): StageHandoff[] { return DEFAULT_CHAIN.map(({ stage, team, artifact }) => { const pod = POD_LEADERS[team] || { leader: team.toUpperCase(), name: team }; return { stage, team, leader: pod.leader, status: 'pending' as const, startedAt: null, completedAt: null, notes: '', artifacts: [], artifactRequired: artifact, artifactValue: null, artifactVerified: false, artifactVerifiedAt: null, artifactVerifyError: null } }) }
function seed(): void {
  if (seeded) return
  seeded = true
  const samples = [
    { title: 'Affiliate Blog Network — AI Tools Niche', description: 'Build a 12-article SEO-optimized affiliate blog network targeting AI tools reviews.', revenueTarget: 4200, priority: 'high' as const, category: 'Affiliate' },
    { title: 'SaaS Micro-Tool — PDF Annotator', description: 'Launch a $9/mo SaaS for PDF annotation with Stripe checkout.', revenueTarget: 6800, priority: 'critical' as const, category: 'SaaS' },
    { title: 'Trading Bot — Stablecoin Yield', description: 'Deploy a conservative stablecoin yield aggregator on Arbitrum.', revenueTarget: 3500, priority: 'medium' as const, category: 'Trading' },
  ]
  const stages: MissionStage[] = ['IN_PROGRESS','DELIVERED','VERIFIED']
  samples.forEach((s, idx) => {
    const chain = buildChain(); const currentStage = stages[idx] || 'IN_PROGRESS'; const stageIdx = STAGE_ORDER.indexOf(currentStage)
    chain.forEach((c, i) => { if (i < stageIdx) { c.status = 'done'; c.startedAt = nowIso(); c.completedAt = nowIso(); if (c.artifactRequired !== 'none') { c.artifactValue = c.artifactRequired === 'url' ? 'https://example.com/demo-artifact' : 'Demo artifact data (seed mission)'; c.artifactVerified = true; c.artifactVerifiedAt = nowIso() } } else if (i === stageIdx) { c.status = 'active'; c.startedAt = nowIso() } })
    store.push({ id: SEED_MISSION_IDS[idx] || uid('mission'), ownerId: null, title: s.title, description: s.description, revenueTarget: s.revenueTarget, createdAt: '2026-07-21T00:00:00.000Z', updatedAt: nowIso(), currentStage, priority: s.priority, category: s.category, chain, log: [{ timestamp: '2026-07-21T00:00:00.000Z', actor: 'SYSTEM', stage: 'PLANNED', message: `Mission created by CEO. Target: $${s.revenueTarget}/month.` }], threads: [] })
  })
}
export function listActiveMissions(): ActiveMission[] { seed(); return store }
export function getActiveMission(id: string): ActiveMission | null { seed(); return store.find((m) => m.id === id) || null }
export function createActiveMission(input: { title: string; description: string; ownerId?: string | null; revenueTarget?: number; priority?: ActiveMission['priority']; category?: string }): ActiveMission {
  seed(); const mission: ActiveMission = { id: uid('mission'), ownerId: input.ownerId ?? null, title: input.title, description: input.description, revenueTarget: input.revenueTarget ?? 0, createdAt: nowIso(), updatedAt: nowIso(), currentStage: 'PLANNED', priority: input.priority ?? 'medium', category: input.category ?? 'General', chain: buildChain().map((c, i) => i === 0 ? { ...c, status: 'active' as const, startedAt: nowIso() } : c), log: [{ timestamp: nowIso(), actor: 'CEO', stage: 'PLANNED', message: `New mission created: ${input.title}.` }], threads: [] }; store.unshift(mission); return mission
}
export function advanceMissionStage(missionId: string): ActiveMission | null {
  seed(); const m = store.find((x) => x.id === missionId); if (!m) return null; const currentIdx = STAGE_ORDER.indexOf(m.currentStage); if (currentIdx >= STAGE_ORDER.length - 1) return m; const current = m.chain.find((c) => c.stage === m.currentStage)
  if (current?.artifactRequired !== 'none' && (!current.artifactValue || !current.artifactVerified)) { current.status = 'blocked'; current.artifactVerifyError = current.artifactVerifyError || `Cannot advance: ${current.artifactRequired} artifact is not verified.`; m.updatedAt = nowIso(); return m }
  if (current) { current.status = 'done'; current.completedAt = nowIso() }; const nextStage = STAGE_ORDER[currentIdx + 1]; assertMissionTransition(m.currentStage, nextStage); m.currentStage = nextStage; const next = m.chain.find((c) => c.stage === nextStage); if (next) { next.status = 'active'; next.startedAt = nowIso() }; m.updatedAt = nowIso(); m.log.push({ timestamp: nowIso(), actor: current?.leader || 'SYSTEM', stage: nextStage, message: `Stage advanced ${current?.stage ?? m.currentStage} → ${nextStage}.` }); return m
}
export function appendLeaderMessage(missionId: string, leaderId: string, from: 'OWNER' | 'LEADER', text: string): LeaderThread | null { seed(); const m = store.find((x) => x.id === missionId); if (!m) return null; const current = m.chain.find((c) => c.stage === m.currentStage); const target = leaderId || current?.team || ''; const info = POD_LEADERS[target] || { leader: target.toUpperCase(), name: target }; let thread = m.threads.find((t) => t.leaderId === target && t.stage === m.currentStage); if (!thread) { thread = { id: uid('thread'), missionId: m.id, leaderId: target, leaderName: info.leader, stage: m.currentStage, messages: [] }; m.threads.push(thread) }; thread.messages.push({ id: uid('msg'), from, author: from === 'OWNER' ? 'Owner' : info.leader, text, timestamp: nowIso() }); m.log.push({ timestamp: nowIso(), actor: from === 'OWNER' ? 'OWNER' : info.leader, stage: m.currentStage, message: text.slice(0, 200) }); m.updatedAt = nowIso(); return thread }
export function getLeaderForCurrentStage(missionId: string): { leaderId: string; leaderName: string; stage: MissionStage } | null { seed(); const m = store.find((x) => x.id === missionId); if (!m) return null; const handoff = m.chain.find((c) => c.stage === m.currentStage); return handoff ? { leaderId: handoff.team, leaderName: handoff.leader, stage: m.currentStage } : null }
export function approveMission(missionId: string): ActiveMission | null { seed(); const m = store.find((x) => x.id === missionId); if (!m) return null; let guard = 0; while (m.currentStage !== 'OWNER_APPROVAL' && m.currentStage !== 'COMPLETED' && guard < 10) { advanceMissionStage(missionId); guard++ }; const handoff = m.chain.find((c) => c.stage === m.currentStage); if (handoff) { handoff.status = 'done'; handoff.completedAt = nowIso() }; m.currentStage = 'COMPLETED'; m.updatedAt = nowIso(); return m }
export const POD_LEADER_MAP = POD_LEADERS
export function setStageArtifact(missionId: string, artifactValue: string, verified = false): ActiveMission | null { seed(); const m = store.find((x) => x.id === missionId); if (!m) return null; const handoff = m.chain.find((c) => c.stage === m.currentStage); if (!handoff) return null; handoff.artifactValue = artifactValue; handoff.artifactVerified = verified; handoff.artifactVerifiedAt = verified ? nowIso() : null; handoff.artifactVerifyError = null; if (verified && handoff.status === 'blocked') handoff.status = 'active'; m.updatedAt = nowIso(); void registerArtifact({ artifactId: buildArtifactId({ ventureId: null, missionId: m.id, stage: m.currentStage, artifactType: handoff.artifactRequired, value: artifactValue }), ventureId: null, missionId: m.id, stage: m.currentStage, producer: handoff.leader, consumers: [], artifactType: handoff.artifactRequired, value: artifactValue, version: 1, supersedes: null }).then(async (record) => { if (verified) await verifyArtifact(record.artifactId, handoff.leader, 'mission-stage-verified') }).catch(() => {}); return m }
export async function verifyStageArtifact(missionId: string): Promise<ActiveMission | null> { seed(); const m = store.find((x) => x.id === missionId); if (!m) return null; const handoff = m.chain.find((c) => c.stage === m.currentStage); if (!handoff) return null; if (!handoff.artifactValue) { handoff.artifactVerifyError = 'No artifact value to verify'; return m }; let verified = false; let errorMsg: string | null = null; try { if (handoff.artifactRequired === 'url') { const resp = await fetch(handoff.artifactValue, { method: 'HEAD', signal: AbortSignal.timeout(10000) }).catch(() => null); verified = Boolean(resp?.ok); if (!verified) errorMsg = `URL verification failed: HTTP ${resp?.status ?? 'no response'}` } else if (handoff.artifactRequired === 'transaction_id') { verified = handoff.artifactValue.length >= 8; if (!verified) errorMsg = 'Transaction ID too short' } else if (handoff.artifactRequired === 'message_id') { verified = handoff.artifactValue.length >= 4; if (!verified) errorMsg = 'Message ID too short' } else if (handoff.artifactRequired === 'data' || handoff.artifactRequired === 'file_path') { verified = handoff.artifactValue.length >= 10; if (!verified) errorMsg = 'Artifact data too short' } else verified = true } catch (error) { errorMsg = `Verification error: ${error instanceof Error ? error.message.slice(0, 100) : String(error)}` }; handoff.artifactVerified = verified; handoff.artifactVerifiedAt = verified ? nowIso() : null; handoff.artifactVerifyError = verified ? null : errorMsg; if (verified && handoff.status === 'blocked') handoff.status = 'active'; m.updatedAt = nowIso(); return m }
