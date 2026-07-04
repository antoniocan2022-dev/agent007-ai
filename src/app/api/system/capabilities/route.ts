import { NextResponse } from 'next/server'
import { db, ensureDbReady } from '@/lib/db'
import { getCapabilities } from '@/lib/system-functions'
import { SUBAGENTS, FULL_ACCESS_TOOLS } from '@/lib/subagents'
import fs from 'node:fs'
import path from 'node:path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * /api/system/capabilities
 *
 * Live, authoritative capabilities report. The heavy lifting (tool count,
 * manage-action count, agent count, mission, upgrades) is delegated to
 * `getCapabilities()` in src/lib/system-functions.ts which pulls counts
 * directly from the runtime registries (TOOL_REGISTRY, MANAGE_ACTIONS,
 * SUBAGENTS, getAllUpgrades) — NO source-code regex, NO drift.
 *
 * This route only adds infrastructure metadata (API route count, DB model
 * count, source file count, protection mode) that is request-scoped.
 */
export async function GET() {
  try {
    await ensureDbReady()

    // ── Authoritative counts from system-functions.ts ───────────────────
    const caps = await getCapabilities()

    // ── Infrastructure metadata (request-scoped) ────────────────────────
    const apiRouteCount = countApiRoutes()
    const dbModelCount = countDbModels()
    const sourceFileCount = countSourceFiles()

    const categories = [
      'base', 'business', 'self_repair', 'autonomous_resolution', 'safety',
      'self_modification', 'self_improvement', 'loyalty', 'communication',
      'enhanced', 'developer', 'media', 'owner_vault', 'owner_auth',
      'self_heal', 'max_improvements', 'subagent_full_access',
    ]

    return NextResponse.json({
      ok: true,
      timestamp: caps.timestamp,
      tools: {
        total: caps.tools.total,
        baseRegistry: 11, // legacy field — the literal entries in TOOL_REGISTRY
        perSubagent: caps.tools.perSubagent,
        categories: categories.length,
        categoryList: categories,
        sample: caps.tools.sample,
        note: caps.tools.note,
      },
      agents: {
        total: caps.agents.total,
        builtin: caps.agents.builtin,
        custom: caps.agents.custom,
        allHaveFullAccess: caps.agents.allHaveFullAccess,
        toolsPerAgent: caps.agents.toolsPerAgent,
        fullAccessToolList: FULL_ACCESS_TOOLS,
      },
      manageActions: {
        total: caps.manageActions.total,
        list: caps.manageActions.list,
        note: caps.manageActions.note,
      },
      mission: caps.mission,
      upgrades: caps.upgrades,
      infrastructure: {
        apiRoutes: apiRouteCount,
        dbModels: dbModelCount,
        sourceFiles: sourceFileCount,
        protectionMode: 'UPGRADE_ONLY',
        ownerAuthMethods: ['whatsapp', 'sms', 'email', 'totp'],
        permanentlyDisabledOps: 13,
        protectedOps: 21,
      },
      summary: {
        availableTools: caps.summary.availableTools,
        availableAgents: caps.summary.availableAgents,
        managementActions: caps.summary.managementActions,
        monthlyIncomeTarget: caps.summary.monthlyIncomeTarget,
        growthRate: caps.summary.growthRate,
        dailyGrowthTarget: caps.summary.dailyGrowthTarget,
        monthlyGrowthRate: caps.summary.monthlyGrowthRate,
        permanentUpgrades: caps.summary.permanentUpgrades,
        subagentToolAccess: caps.summary.subagentToolAccess,
        toolsPerAgent: caps.summary.toolsPerAgent,
        apiRoutes: apiRouteCount,
        dbModels: dbModelCount,
      },
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 })
  }
}

/**
 * Walk src/app/api/ and count route.ts / route.js files.
 */
function countApiRoutes(): number {
  try {
    const apiDir = path.join(process.cwd(), 'src/app/api')
    if (!fs.existsSync(apiDir)) return 0
    const countRoutes = (dir: string): number => {
      let count = 0
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          count += countRoutes(fullPath)
        } else if (entry.name === 'route.ts' || entry.name === 'route.js') {
          count += 1
        }
      }
      return count
    }
    return countRoutes(apiDir)
  } catch {
    return 0
  }
}

/**
 * Count Prisma models by inspecting the db object. Filters out private
 * fields (starting with _ or $) and requires a callable .count property
 * to be considered a real model.
 */
function countDbModels(): number {
  try {
    const models = Object.keys(db).filter(
      (k) => !k.startsWith('_') && !k.startsWith('$') && typeof (db as any)[k]?.count === 'function'
    )
    return models.length
  } catch {
    return 0
  }
}

/**
 * Walk src/ and count .ts / .tsx files. This is a quick proxy for
 * "how big is the codebase" — not authoritative, just a metric.
 */
function countSourceFiles(): number {
  try {
    const srcDir = path.join(process.cwd(), 'src')
    if (!fs.existsSync(srcDir)) return 0
    let count = 0
    const walk = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          walk(fullPath)
        } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
          count += 1
        }
      }
    }
    walk(srcDir)
    return count
  } catch {
    return 0
  }
}
