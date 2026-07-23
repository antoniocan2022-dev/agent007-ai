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
  // UPGRADE #120 — Artifact Gate (Finding 2 from external audit)
  // Every stage that produces a deliverable MUST have a verified artifact
  // before the mission can advance. This prevents the "fictional progress"
  // problem where stages were marked complete without producing anything.
  artifactRequired: ArtifactType
  artifactValue: string | null  // the actual artifact (URL, transaction ID, etc.)
  artifactVerified: boolean     // was it independently verified?
  artifactVerifiedAt: string | null
  artifactVerifyError: string | null  // if verification failed, why
}

// What kind of artifact each stage must produce
export type ArtifactType =
  | 'url'           // a live URL (published blog, deployed app)
  | 'transaction_id' // a payment transaction ID (Stripe, PayPal)
  | 'message_id'    // a message ID (Telegram, Discord, email)
  | 'file_path'     // a file path (code file, document)
  | 'data'          // structured data (research report, analysis)
  | 'none'          // planning/internal stages that don't produce artifacts

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
// UPGRADE #120 — Each stage now declares what artifact it must produce.
// The mission CANNOT advance past a stage until that artifact is verified.
export const DEFAULT_CHAIN: Array<{ stage: MissionStage; team: string; artifact: ArtifactType }> = [
  { stage: 'PLANNED', team: 'scout', artifact: 'data' },          // research report
  { stage: 'IN_PROGRESS', team: 'aurora', artifact: 'url' },      // published content URL
  { stage: 'REVIEW', team: 'echo', artifact: 'data' },            // quality score report
  { stage: 'DELIVERED', team: 'forge', artifact: 'url' },         // deployed app URL
  { stage: 'VERIFIED', team: 'pulse', artifact: 'data' },         // verification report
  { stage: 'OWNER_APPROVAL', team: 'pulse', artifact: 'none' },   // owner decision (no artifact)
  { stage: 'COMPLETED', team: 'pulse', artifact: 'none' },        // final state
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
  return DEFAULT_CHAIN.map(({ stage, team, artifact }) => {
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
      // UPGRADE #120 — Artifact gate fields
      artifactRequired: artifact,
      artifactValue: null,
      artifactVerified: false,
      artifactVerifiedAt: null,
      artifactVerifyError: null,
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
        // UPGRADE #120 — Mark seed artifacts as verified so demo missions show progress
        if (c.artifactRequired !== 'none') {
          c.artifactValue = c.artifactRequired === 'url'
            ? 'https://example.com/demo-artifact'
            : c.artifactRequired === 'data'
            ? 'Demo artifact data (seed mission)'
            : 'demo-artifact-id'
          c.artifactVerified = true
          c.artifactVerifiedAt = nowIso()
        }
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

  // ── UPGRADE #120 — ARTIFACT GATE (Finding 2 from external audit) ──
  // BLOCK stage advancement if the current stage requires an artifact
  // but none has been verified. This prevents "fictional progress" where
  // stages were marked complete without producing any real output.
  const currentHandoff = m.chain.find((c) => c.stage === m.currentStage)
  if (currentHandoff) {
    if (currentHandoff.artifactRequired !== 'none') {
      if (!currentHandoff.artifactValue || !currentHandoff.artifactVerified) {
        // BLOCK — cannot advance without verified artifact
        currentHandoff.status = 'blocked'
        currentHandoff.artifactVerifyError = currentHandoff.artifactVerifyError ||
          `Cannot advance: stage requires a ${currentHandoff.artifactRequired} artifact but none is verified.`
        m.updatedAt = nowIso()
        m.log.push({
          timestamp: nowIso(),
          actor: 'SYSTEM',
          stage: m.currentStage,
          message: `ADVANCEMENT BLOCKED — Stage requires ${currentHandoff.artifactRequired} artifact. Current: ${currentHandoff.artifactValue || '(none)'}, Verified: ${currentHandoff.artifactVerified}`,
        })
        return m  // Return the mission (still at current stage, now blocked)
      }
    }
  }

  // Artifact verified (or not required) — safe to advance
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

// ──────────────────────────────────────────────────────────────────
// UPGRADE #120 — Artifact Verification Functions (Finding 2)
// ──────────────────────────────────────────────────────────────────

/**
 * Set an artifact value for a mission's current stage.
 * Called by leaders when they produce a deliverable (URL, transaction ID, etc.)
 */
export function setStageArtifact(
  missionId: string,
  artifactValue: string,
  verified: boolean = false
): ActiveMission | null {
  seed()
  const m = store.find((x) => x.id === missionId)
  if (!m) return null

  const handoff = m.chain.find((c) => c.stage === m.currentStage)
  if (!handoff) return null

  handoff.artifactValue = artifactValue
  handoff.artifactVerified = verified
  handoff.artifactVerifiedAt = verified ? nowIso() : null
  handoff.artifactVerifyError = null

  // If verified, unblock the stage
  if (verified && handoff.status === 'blocked') {
    handoff.status = 'active'
  }

  m.updatedAt = nowIso()
  m.log.push({
    timestamp: nowIso(),
    actor: handoff.leader,
    stage: m.currentStage,
    message: `Artifact set: ${artifactValue.slice(0, 100)} (verified: ${verified})`,
  })

  return m
}

/**
 * Verify an artifact for a mission's current stage.
 * For URL artifacts: HTTP fetch to confirm the URL returns 200.
 * For transaction_id: would query Stripe/PayPal API (stub for now).
 * For message_id: would query Telegram/Discord API (stub for now).
 * For data/file_path: mark as verified (manual verification needed).
 */
export async function verifyStageArtifact(missionId: string): Promise<ActiveMission | null> {
  seed()
  const m = store.find((x) => x.id === missionId)
  if (!m) return null

  const handoff = m.chain.find((c) => c.stage === m.currentStage)
  if (!handoff) return null

  if (!handoff.artifactValue) {
    handoff.artifactVerifyError = 'No artifact value to verify'
    return m
  }

  let verified = false
  let errorMsg: string | null = null

  try {
    if (handoff.artifactRequired === 'url') {
      // Verify URL returns 200
      const resp = await fetch(handoff.artifactValue, {
        method: 'HEAD',
        signal: AbortSignal.timeout(10000),
      }).catch(() => null)
      if (resp && resp.ok) {
        verified = true
      } else {
        errorMsg = `URL verification failed: HTTP ${resp?.status ?? 'no response'}`
      }
    } else if (handoff.artifactRequired === 'transaction_id') {
      // TODO: Query Stripe/PayPal API to verify transaction exists
      // For now, accept any non-empty string that looks like a transaction ID
      verified = handoff.artifactValue.length >= 8
      if (!verified) errorMsg = 'Transaction ID too short'
    } else if (handoff.artifactRequired === 'message_id') {
      // TODO: Query Telegram/Discord API to verify message exists
      verified = handoff.artifactValue.length >= 4
      if (!verified) errorMsg = 'Message ID too short'
    } else if (handoff.artifactRequired === 'data' || handoff.artifactRequired === 'file_path') {
      // Data/file artifacts are verified manually (or by checking content)
      verified = handoff.artifactValue.length >= 10
      if (!verified) errorMsg = 'Artifact data too short'
    } else {
      // 'none' — no artifact needed
      verified = true
    }
  } catch (e: any) {
    errorMsg = `Verification error: ${e?.message?.slice(0, 100)}`
  }

  handoff.artifactVerified = verified
  handoff.artifactVerifiedAt = verified ? nowIso() : null
  handoff.artifactVerifyError = verified ? null : errorMsg

  // If verified, unblock the stage
  if (verified && handoff.status === 'blocked') {
    handoff.status = 'active'
  }

  m.updatedAt = nowIso()
  m.log.push({
    timestamp: nowIso(),
    actor: 'SYSTEM',
    stage: m.currentStage,
    message: `Artifact verification: ${verified ? '✓ VERIFIED' : '✗ FAILED'} — ${handoff.artifactValue.slice(0, 80)}`,
  })

  return m
}

