/**
 * /api/system/vid-backup
 * ---------------------
 * On-demand VID backup generator. Returns a complete backup of the
 * Agent007 project (source code + live Vercel snapshot) as a
 * downloadable JSON or gzipped JSON file. Streamed directly to the
 * client — no persistent storage needed (Vercel /tmp is ephemeral).
 *
 * QUERY PARAMS:
 *   ?format=json  → JSON manifest (default)
 *   ?format=zip   → gzipped JSON (smaller, faster download)
 *
 * RESPONSE:
 *   - 200: File download with Content-Disposition: attachment
 *   - 500: Backup generation failed
 */
import { NextRequest, NextResponse } from 'next/server'
import { TOOL_REGISTRY } from '@/lib/tools'
import { SUBAGENTS } from '@/lib/subagents'
import {
  VID_MISSION, VID_LEADER, VID_MEMBERS, CHIEF_VENTURE_SCIENTIST,
  VID_SPECIALISTS, VID_ORG_RULES_NEVER, VENTURE_SCORE_CATEGORIES,
  VENTURE_SCORE_THRESHOLD, VID_WORKFLOW_STAGES, VID_KPIS,
  KNOWLEDGE_TRANSFER_RATE_BANNER,
} from '@/lib/vid-data'
import { getPortfolio, getActiveBusinesses, computeEnterpriseValue } from '@/lib/business-portfolio'
import { createGzip } from 'node:zlib'
import { Readable } from 'node:stream'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function getGitInfo() {
  return {
    commit: process.env.VERCEL_GIT_COMMIT_SHA || 'unknown',
    branch: process.env.VERCEL_GIT_COMMIT_REF || 'main',
    message: process.env.VERCEL_GIT_COMMIT_MESSAGE || '',
    author: process.env.VERCEL_GIT_COMMIT_AUTHOR_NAME || '',
    repo: process.env.VERCEL_GIT_REPO_URL || 'https://github.com/antoniocan2022-dev/agent007-ai',
  }
}

async function buildLiveSnapshot() {
  const [portfolio, activeBusinesses, enterpriseValue] = await Promise.all([
    getPortfolio(),
    getActiveBusinesses(),
    computeEnterpriseValue(),
  ])

  return {
    version: {
      git: getGitInfo(),
      vercel: {
        deploymentUrl: process.env.VERCEL_URL || 'https://agent007-ai.vercel.app',
        environment: process.env.VERCEL_ENV || 'production',
        region: process.env.VERCEL_REGION || 'iad1',
      },
      timestamp: new Date().toISOString(),
    },
    portfolio: {
      count: portfolio.length,
      activeCount: activeBusinesses.length,
      retiredCount: portfolio.length - activeBusinesses.length,
      businesses: portfolio.map((b: any) => ({
        id: b.businessId,
        name: (b.name || '').slice(0, 100),
        type: b.type,
        lifecycle: b.lifecycle,
        mrr: Number(b.monthlyRevenue) || 0,
        customers: Number(b.customerCount) || 0,
        automationLevel: Number(b.automationLevel) || 0,
        knowledgeAssets: Number(b.knowledgeAssets) || 0,
      })),
    },
    enterpriseValue: {
      totalValue: enterpriseValue.totalValue,
      components: enterpriseValue.components,
      totalMonthlyRevenue: enterpriseValue.totalMonthlyRevenue,
      totalCustomers: enterpriseValue.totalCustomers,
    },
    vid_structure: {
      mission: VID_MISSION,
      leader: {
        name: VID_LEADER.name,
        rank: VID_LEADER.rank,
        reportsTo: VID_LEADER.reportsTo,
        iqRank: VID_LEADER.iqRank,
        personality: VID_LEADER.personality,
        responsibilities: VID_LEADER.responsibilities,
        kpis: VID_LEADER.kpis,
      },
      members: VID_MEMBERS.map(m => ({
        id: m.id, name: m.name, role: m.role, mission: m.mission,
        scope: m.scope, personality: m.personality, toolDomain: m.toolDomain,
        tools: m.tools, output: m.output, highlight: m.highlight,
      })),
      chief_venture_scientist: CHIEF_VENTURE_SCIENTIST,
      specialists: VID_SPECIALISTS,
      org_rules_never: VID_ORG_RULES_NEVER,
      venture_score: {
        categories: VENTURE_SCORE_CATEGORIES,
        threshold: VENTURE_SCORE_THRESHOLD,
      },
      workflow_stages: VID_WORKFLOW_STAGES,
      kpis: VID_KPIS,
      knowledge_transfer_rate: KNOWLEDGE_TRANSFER_RATE_BANNER,
    },
    tools: {
      total_registered: Object.keys(TOOL_REGISTRY).length,
      sample: Object.keys(TOOL_REGISTRY).slice(0, 20),
    },
    subagents: {
      total: SUBAGENTS.length,
      ids: SUBAGENTS.map(s => ({ id: s.id, name: s.name, role: s.role, enabled: s.enabled, isBuiltin: s.isBuiltin })),
    },
  }
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const format = (url.searchParams.get('format') ?? 'json').toLowerCase()

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const snapshot = await buildLiveSnapshot()
    const gitInfo = getGitInfo()

    const manifest = {
      backup_metadata: {
        generated_at: timestamp,
        tool: 'agent007-vid-backup endpoint v1.0',
        project: 'Agent007 AI',
        live_url: 'https://agent007-ai.vercel.app',
        git: gitInfo,
        endpoint: '/api/system/vid-backup',
      },
      live_snapshot: snapshot,
      files_included_note: 'For full source code, see https://github.com/antoniocan2022-dev/agent007-ai',
    }

    if (format === 'zip') {
      // Stream a gzipped JSON
      const jsonStr = JSON.stringify(manifest, null, 2)
      const gzip = createGzip()
      const stream = Readable.from([jsonStr]).pipe(gzip)

      const webStream = new ReadableStream({
        start(controller) {
          stream.on('data', (chunk) => controller.enqueue(new Uint8Array(chunk)))
          stream.on('end', () => controller.close())
          stream.on('error', (e) => controller.error(e))
        },
      })

      return new NextResponse(webStream, {
        status: 200,
        headers: {
          'Content-Type': 'application/gzip',
          'Content-Disposition': `attachment; filename="agent007-vid-backup-${timestamp}.json.gz"`,
          'Cache-Control': 'no-cache',
        },
      })
    }

    // Default: JSON response with download header
    const jsonStr = JSON.stringify(manifest, null, 2)
    return new NextResponse(jsonStr, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="agent007-vid-backup-${timestamp}.json"`,
        'Cache-Control': 'no-cache',
      },
    })
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? 'Backup generation failed' },
      { status: 500 }
    )
  }
}
