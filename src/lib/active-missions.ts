/**
 * active-missions.ts — UPGRADE #111
 * ===================================================================
 * In-memory Active Missions store with Team Chain workflow.
 *
 * Lifecycle:
 *   PLANNED → IN_PROGRESS → REVIEW → DELIVERED → VERIFIED → OWNER_APPROVAL → COMPLETED
 *
 * Each stage is owned by a specific Team (pod). A mission flows through the chain:
 *   Team A (Scout) creates →
 *   Team B (Aurora) builds →
 *   Team C (Echo) verifies →
 *   Team D (Forge) delivers →
 *   Team E (Pulse) monitors →
 *   Owner approves →
 *   Mission complete
 *
 * Used by the new "Mission Actives" tab in the dashboard.
 */

export type MissionStage =
  | 'PLANNED'
  | 'IN_PROGRESS'
  | 'REVIEW'
  | 'DELIVERED'
  | 'VERIFIED'
  | 'OWNER_APPROVAL'
  | 'COMPLETED'

export const STAGE_ORDER: MissionStage[] = [
  'PLANNED',
  'IN_PROGRESS',
  'REVIEW',
  'DELIVERED',
  'VERIFIED',
  'OWNER_APPROVAL',
  'COMPLETED',
]

export interface StageHandoff {
  stage: MissionStage
  team: string // pod id (scout, aurora, echo, forge, pulse, etc.)
  leader: string
  status: 'pending' | 'active' | 'done' | 'blocked'
  startedAt: string | null
  completedAt: string | null
  notes: string
  artifacts: string[] // urls, file names, deliverable references
}

export interface MissionLogEntry {
  timestamp: string
  actor: string // leader name or 'OWNER'
  stage: MissionStage
  message: string
}

export interface ActiveMission {
  id: string
  title: string
  description: string
  revenueTarget: number // $/month expected when complete
  createdAt: string
  updatedAt: string
  currentStage: MissionStage
  priority: 'low' | 'medium' | 'high' | 'critical'
  category: string // e.g. 'Affiliate', 'SaaS', 'Content', 'Trading'
  // Chain of teams that own each stage
  chain: StageHandoff[]
  // Audit log of all transitions and leader messages
  log: MissionLogEntry[]
  // Owner questions/answers for the leader currently in charge
  threads: LeaderThread[]
}

export interface LeaderThread {
  id: string
  missionId: string
  leaderId: string
  leaderName: string
  stage: MissionStage
  messages: LeaderMessage[]
}

export interface LeaderMessage {
  id: string
  from: 'OWNER' | 'LEADER'
  author: string
  text: string
  timestamp: string
}

// ──────────────────────────────────────────────────────────────────
// POD LEADER MAP (must match src/app/api/team/[leaderId]/route.ts)
// ──────────────────────────────────────────────────────────────────
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

// Default team chain for new missions — Scout → Aurora → Echo → Forge → Pulse → Owner
export const DEFAULT_CHAIN: Array<{ stage: MissionStage; team: string }> = [
  { stage: 'PLANNED', team: 'scout' },
  { stage: 'IN_PROGRESS', team: 'aurora' },
  { stage: 'REVIEW', team: 'echo' },
  { stage: 'DELIVERED', team: 'forge' },
  { stage: 'VERIFIED', team: 'pulse' },
  { stage: 'OWNER_APPROVAL', team: 'pulse' },
  { stage: 'COMPLETED', team: 'pulse' },
]

// ──────────────────────────────────────────────────────────────────
// In-memory store (persists per warm function instance).
// For production persistence, swap to a Prisma model — but for Vercel
// serverless this provides enough state to demo the chain.
// ──────────────────────────────────────────────────────────────────
let store: ActiveMission[] = []
let seeded = false

function nowIso() { return new Date().toISOString() }
function uid(prefix: string) { return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}` }

// Deterministic IDs for seeded missions — so any serverless instance
// produces the same IDs and cross-instance fetches work.
const SEED_MISSION_IDS = [
  'mission_seed_affiliate_blog',
  'mission_seed_saas_pdf_annotator',
  'mission_seed_trading_stablecoin',
]

function buildChain(): StageHandoff[] {
  return DEFAULT_CHAIN.map(({ stage, team }) => {
    const pod = POD_LEADERS[team] || { leader: team.toUpperCase(), name: team }
    return {
      stage,
      team,
      leader: pod.leader,
      status: 'pending' as const,
      startedAt: null,
      completedAt: null,
      notes: '',
      artifacts: [],
    }
  })
}

function seed(): void {
  if (seeded) return
  seeded = true

  // Seed 3 sample active missions at different stages of the chain
  const samples: Array<Partial<ActiveMission> & { title: string; description: string }> = [
    {
      title: 'Affiliate Blog Network — AI Tools Niche',
      description: 'Build a 12-article SEO-optimized affiliate blog network targeting AI tools reviews. Each article ranks for a high-intent keyword with affiliate links to Jasper, Copy.ai, Notion AI, etc.',
      revenueTarget: 4200,
      priority: 'high',
      category: 'Affiliate',
    },
    {
      title: 'SaaS Micro-Tool — PDF Annotator',
      description: 'Launch a $9/mo SaaS for PDF annotation with Stripe checkout. Aurora designs UX, Forge builds Next.js app, Echo runs QA, Pulse monitors conversion.',
      revenueTarget: 6800,
      priority: 'critical',
      category: 'SaaS',
    },
    {
      title: 'Trading Bot — Stablecoin Yield',
      description: 'Deploy a conservative stablecoin yield aggregator on Arbitrum. Targets 8-12% APY with auto-compounding. Forge codes, Pulse monitors positions, Echo audits risk.',
      revenueTarget: 3500,
      priority: 'medium',
      category: 'Trading',
    },
  ]

  const stages: MissionStage[] = ['IN_PROGRESS', 'DELIVERED', 'VERIFIED']

  samples.forEach((s, idx) => {
    const chain = buildChain()
    const currentStage = stages[idx] || 'IN_PROGRESS'
    const stageIdx = STAGE_ORDER.indexOf(currentStage)

    // Mark earlier stages as done, current as active
    chain.forEach((c, i) => {
      if (i < stageIdx) {
        c.status = 'done'
        c.startedAt = nowIso()
        c.completedAt = nowIso()
        c.notes = `Completed by ${c.leader}. Handoff to next team.`
      } else if (i === stageIdx) {
        c.status = 'active'
        c.startedAt = nowIso()
        c.notes = `Currently in progress — ${c.leader} is working on this stage.`
      }
    })

    const mission: ActiveMission = {
      id: SEED_MISSION_IDS[idx] || uid('mission'),
      title: s.title!,
      description: s.description!,
      revenueTarget: s.revenueTarget ?? 0,
      createdAt: '2026-07-21T00:00:00.000Z',
      updatedAt: nowIso(),
      currentStage,
      priority: (s.priority as any) || 'medium',
      category: s.category || 'General',
      chain,
      log: [
        {
          timestamp: '2026-07-21T00:00:00.000Z',
          actor: 'SYSTEM',
          stage: 'PLANNED',
          message: `Mission created by CEO. Target: $${s.revenueTarget}/month. Category: ${s.category}.`,
        },
      ],
      threads: [],
    }

    store.push(mission)
  })
}

// ──────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────

export function listActiveMissions(): ActiveMission[] {
  seed()
  return store
}

export function getActiveMission(id: string): ActiveMission | null {
  seed()
  return store.find((m) => m.id === id) || null
}

export function createActiveMission(input: {
  title: string
  description: string
  revenueTarget?: number
  priority?: ActiveMission['priority']
  category?: string
}): ActiveMission {
  seed()
  const mission: ActiveMission = {
    id: uid('mission'),
    title: input.title,
    description: input.description,
    revenueTarget: input.revenueTarget ?? 0,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    currentStage: 'PLANNED',
    priority: input.priority ?? 'medium',
    category: input.category ?? 'General',
    chain: buildChain().map((c, i) =>
      i === 0 ? { ...c, status: 'active' as const, startedAt: nowIso(), notes: 'Mission initiated — first team is working.' } : c
    ),
    log: [
      {
        timestamp: nowIso(),
        actor: 'CEO',
        stage: 'PLANNED',
        message: `New mission created: ${input.title}. Target: $${input.revenueTarget ?? 0}/month.`,
      },
    ],
    threads: [],
  }
  store.unshift(mission)
  return mission
}

export function advanceMissionStage(missionId: string): ActiveMission | null {
  seed()
  const m = store.find((x) => x.id === missionId)
  if (!m) return null

  const currentIdx = STAGE_ORDER.indexOf(m.currentStage)
  if (currentIdx >= STAGE_ORDER.length - 1) return m // already complete

  // Mark current stage as done
  const currentHandoff = m.chain.find((c) => c.stage === m.currentStage)
  if (currentHandoff) {
    currentHandoff.status = 'done'
    currentHandoff.completedAt = nowIso()
  }

  // Advance to next stage
  const nextStage = STAGE_ORDER[currentIdx + 1]
  m.currentStage = nextStage
  const nextHandoff = m.chain.find((c) => c.stage === nextStage)
  if (nextHandoff) {
    nextHandoff.status = 'active'
    nextHandoff.startedAt = nowIso()
  }

  m.updatedAt = nowIso()
  m.log.push({
    timestamp: nowIso(),
    actor: currentHandoff?.leader || 'SYSTEM',
    stage: m.currentStage,
    message: `Stage advanced from ${STAGE_ORDER[currentIdx]} → ${nextStage}. Handed off to ${nextHandoff?.leader || 'next team'}.`,
  })

  return m
}

export function appendLeaderMessage(
  missionId: string,
  leaderId: string,
  from: 'OWNER' | 'LEADER',
  text: string
): LeaderThread | null {
  seed()
  const m = store.find((x) => x.id === missionId)
  if (!m) return null

  // Find or create the thread for the current stage's leader
  const currentHandoff = m.chain.find((c) => c.stage === m.currentStage)
  const targetLeader = leaderId || currentHandoff?.team || ''
  const leaderInfo = POD_LEADERS[targetLeader] || { leader: targetLeader.toUpperCase(), name: targetLeader }

  let thread = m.threads.find((t) => t.leaderId === targetLeader && t.stage === m.currentStage)
  if (!thread) {
    thread = {
      id: uid('thread'),
      missionId: m.id,
      leaderId: targetLeader,
      leaderName: leaderInfo.leader,
      stage: m.currentStage,
      messages: [],
    }
    m.threads.push(thread)
  }

  const msg: LeaderMessage = {
    id: uid('msg'),
    from,
    author: from === 'OWNER' ? 'Owner (Antonio)' : leaderInfo.leader,
    text,
    timestamp: nowIso(),
  }
  thread.messages.push(msg)

  m.log.push({
    timestamp: nowIso(),
    actor: from === 'OWNER' ? 'OWNER' : leaderInfo.leader,
    stage: m.currentStage,
    message: text.slice(0, 200),
  })

  m.updatedAt = nowIso()
  return thread
}

export function getLeaderForCurrentStage(missionId: string): { leaderId: string; leaderName: string; stage: MissionStage } | null {
  seed()
  const m = store.find((x) => x.id === missionId)
  if (!m) return null
  const handoff = m.chain.find((c) => c.stage === m.currentStage)
  if (!handoff) return null
  return { leaderId: handoff.team, leaderName: handoff.leader, stage: m.currentStage }
}

export function approveMission(missionId: string): ActiveMission | null {
  seed()
  const m = store.find((x) => x.id === missionId)
  if (!m) return null

  // Force advance to OWNER_APPROVAL first (cap at chain length to be safe)
  let safetyCounter = 0
  while (m.currentStage !== 'OWNER_APPROVAL' && m.currentStage !== 'COMPLETED' && safetyCounter < 10) {
    advanceMissionStage(missionId)
    safetyCounter++
  }

  // Mark approved
  const handoff = m.chain.find((c) => c.stage === m.currentStage)
  if (handoff) {
    handoff.status = 'done'
    handoff.completedAt = nowIso()
    handoff.notes = 'Owner approved. Mission complete.'
  }

  m.currentStage = 'COMPLETED'
  m.updatedAt = nowIso()
  m.log.push({
    timestamp: nowIso(),
    actor: 'OWNER',
    stage: 'COMPLETED',
    message: 'Owner approved the mission. Marked COMPLETED.',
  })

  return m
}

export const POD_LEADER_MAP = POD_LEADERS
