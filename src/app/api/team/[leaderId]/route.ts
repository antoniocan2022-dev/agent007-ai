/**
 * /api/team/[leaderId] — UPGRADE #97
 * Direct communication with a pod leader.
 * Owner can ask a specific leader for reports, status, or task execution.
 *
 * GET  /api/team/[leaderId]?action=status — get leader's pod status
 * POST /api/team/[leaderId] — send message directly to leader
 *
 * Leaders: scout, aurora, echo, forge, pulse, developer, cybersecurity_r
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { runSubagent, getAllSubagents } from '@/lib/subagents'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const POD_STRUCTURE: Record<string, { name: string; leader: string; members: string[]; focus: string; color: string; target?: string }> = {
  // UPGRADE VID — Venture Intelligence Division is the 2nd most powerful
  // department after the CEO. Reports DIRECTLY to the CEO. Owns venture
  // creation, Venture Score ≥ 87, and Knowledge Transfer Rate.
  vid: {
    name: 'Venture Intelligence Division',
    leader: 'VID Director',
    members: [
      'Opportunity Hunter', 'Market Intelligence Analyst', 'Customer Psychologist',
      'Business Architect', 'MVP Strategist', 'Growth Strategist',
      'Automation Architect', 'Portfolio Manager', 'Chief Venture Scientist',
    ],
    focus: 'Builds, scores, launches, and manages ventures. Venture Score threshold ≥ 87. Owns Knowledge Transfer Rate — the single most important KPI. Mission: Increase Enterprise Value by continuously creating, validating, scaling, and retiring businesses while making every future venture easier, faster, smarter, and more profitable than the last.',
    color: '#00f0ff',
    target: 'KTR ≥ 0.85',
  },
  scout: { name: 'Intelligence & Research', leader: 'SCOUT', members: ['HUNT', 'QUANTUM'], focus: 'Find opportunities, validate demand, research competitors', color: '#38bdf8' },
  aurora: { name: 'Creation & Design', leader: 'AURORA', members: ['QUILL', 'PRISM', 'VERTEX'], focus: 'Create content, design products, build affiliate funnels (Content Specialist merged into AURORA)', color: '#00f0ff' },
  echo: { name: 'Quality Assurance & Testing', leader: 'ECHO', members: ['QA Monitor'], focus: 'Test, verify, score quality, ensure 99% target (Performance Analyst merged into PULSE)', color: '#818cf8' },
  forge: { name: 'Engineering & Implementation', leader: 'FORGE', members: ['Developer', 'TRADER'], focus: 'Build, deploy, fix infrastructure, execute trades', color: '#fb923c' },
  pulse: { name: 'Monitoring & Operations', leader: 'PULSE', members: ['External Monitor', 'THE BANKER', 'Performance Analyst'], focus: 'Monitor systems, track KPIs, financial monitoring, weekly $ contribution board', color: '#fb7185' },
  developer: { name: 'System Health & Infrastructure', leader: 'Developer', members: ['QA Monitor', 'External Monitor'], focus: 'Tool health, API monitoring, infrastructure repair', color: '#10b981' },
  cybersecurity_r: { name: 'Compliance & Security', leader: 'Cybersecurity R', members: ['LEGAL', 'Cybersecurity A', 'THE BANKER'], focus: 'Legal compliance, tax strategy, security auditing', color: '#3b82f6' },
  revenue: { name: 'Revenue (Passive Income)', leader: 'QUANTUM + AURORA', members: ['TRADER', 'THE BANKER', 'PULSE'], focus: 'Owns all passive income streams: affiliate, SaaS, yield, digital products. Hard target: $20K/month, 20% daily growth. Tracks real vs projected income via income_reality_check.', color: '#fbbf24', target: '$20K/month' },
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ leaderId: string }> }) {
  const { leaderId: rawLeaderId } = await params
  const leaderId = rawLeaderId?.toLowerCase()
  const action = new URL(req.url).searchParams.get('action') ?? 'status'

  if (!leaderId || !POD_STRUCTURE[leaderId]) {
    return NextResponse.json({
      ok: false,
      error: `Unknown leader. Available: ${Object.keys(POD_STRUCTURE).join(', ')}`,
    }, { status: 400 })
  }

  const pod = POD_STRUCTURE[leaderId]

  if (action === 'status') {
    return NextResponse.json({
      ok: true,
      pod: {
        id: leaderId,
        name: pod.name,
        leader: pod.leader,
        members: pod.members,
        focus: pod.focus,
        color: pod.color,
        toolCount: 667,
        status: 'ready',
      },
    })
  }

  if (action === 'pods') {
    // Return all pods for dashboard
    return NextResponse.json({
      ok: true,
      pods: Object.entries(POD_STRUCTURE).map(([id, p]) => ({
        id,
        name: p.name,
        leader: p.leader,
        members: p.members,
        focus: p.focus,
        color: p.color,
        toolCount: 667,
      })),
    })
  }

  return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ leaderId: string }> }) {
  const { leaderId: rawLeaderId } = await params
  const leaderId = rawLeaderId?.toLowerCase()

  if (!leaderId || !POD_STRUCTURE[leaderId]) {
    return NextResponse.json({
      ok: false,
      error: `Unknown leader. Available: ${Object.keys(POD_STRUCTURE).join(', ')}`,
    }, { status: 400 })
  }

  const body = await req.json().catch(() => ({}))
  const { message } = body

  if (!message) {
    return NextResponse.json({ ok: false, error: 'Missing "message"' }, { status: 400 })
  }

  const pod = POD_STRUCTURE[leaderId]

  // Dispatch to the leader subagent
  try {
    const allSubs = await getAllSubagents({ includeDisabled: false })
    const sub = allSubs.find((s: any) =>
      s.id === leaderId || s.name.toLowerCase() === pod.leader.toLowerCase()
    )

    if (!sub) {
      return NextResponse.json({
        ok: false,
        error: `Leader ${pod.leader} not found or disabled`,
      }, { status: 404 })
    }

    const result = await runSubagent({
      subagentId: sub.id,
      task: `[DIRECT FROM OWNER] ${message}\n\nContext: You are the LEADER of ${pod.name} pod. Your team: ${pod.members.join(', ')}. Focus: ${pod.focus}. Provide a direct, actionable response. If you need your team members, mention which ones you'd dispatch and why.`,
      dispatchId: `leader_${Date.now()}`,
      attachments: [],
      language: 'en',
      emit: async () => {},
      parentConversationId: 'leader-chat',
    })

    return NextResponse.json({
      ok: true,
      leader: pod.leader,
      pod: pod.name,
      message: message,
      response: result.answer,
    })
  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      error: e?.message ?? 'Failed to dispatch to leader',
    }, { status: 500 })
  }
}
