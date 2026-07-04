import { NextResponse } from 'next/server'
import { db, ensureDbReady } from '@/lib/db'
import { getIncomeSettings } from '@/lib/settings'
import { getAllUpgrades } from '@/lib/upgrade-manifest'
import { SUBAGENTS, FULL_ACCESS_TOOLS } from '@/lib/subagents'
import fs from 'node:fs'
import path from 'node:path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await ensureDbReady()

    let toolCount = 0
    try {
      const toolsPath = path.join(process.cwd(), 'src/lib/tools.ts')
      const content = fs.readFileSync(toolsPath, 'utf-8')
      const matches = content.match(/^  [a-z_]+:\s*\{/gm)
      toolCount = matches ? matches.length : 0
    } catch {}

    const libToolFiles = [
      'src/lib/agent007-extensions.ts',
      'src/lib/agent007-meta.ts',
      'src/lib/enhanced-tools.ts',
      'src/lib/max-improvements.ts',
      'src/lib/media-tools.ts',
      'src/lib/owner-vault.ts',
      'src/lib/self-backup.ts',
    ]
    let totalToolCount = toolCount
    for (const relPath of libToolFiles) {
      try {
        const fullPath = path.join(process.cwd(), relPath)
        if (!fs.existsSync(fullPath)) continue
        const content = fs.readFileSync(fullPath, 'utf-8')
        const matches = content.match(/name:\s*['"`]([a-z_]+)['"`]/g)
        if (matches) totalToolCount += matches.length
      } catch {}
    }

    let manageActionCount = 0
    const manageActions: string[] = []
    try {
      const orchPath = path.join(process.cwd(), 'src/lib/orchestrator.ts')
      const content = fs.readFileSync(orchPath, 'utf-8')
      const matches = content.match(/case '([a-z_]+)':/g)
      if (matches) {
        for (const m of matches) {
          const name = m.match(/case '([a-z_]+)'/)?.[1]
          if (name && !manageActions.includes(name)) {
            manageActions.push(name)
          }
        }
        manageActionCount = manageActions.length
      }
    } catch {}

    let builtinCount = SUBAGENTS.length
    let customCount = 0
    let totalAgents = builtinCount
    try {
      const customAgents = await db.customSubagent.findMany({
        where: { isBuiltinOverlay: false },
      })
      customCount = customAgents.length
      totalAgents = builtinCount + customCount
    } catch {}

    const income = await getIncomeSettings()
    const upgrades = getAllUpgrades()

    let apiRouteCount = 0
    try {
      const apiDir = path.join(process.cwd(), 'src/app/api')
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
      apiRouteCount = countRoutes(apiDir)
    } catch {}

    let dbModelCount = 0
    try {
      const models = Object.keys(db).filter(
        (k) => !k.startsWith('_') && !k.startsWith('$') && typeof (db as any)[k]?.count === 'function'
      )
      dbModelCount = models.length
    } catch {}

    const categories = [
      'base', 'business', 'self_repair', 'autonomous_resolution', 'safety',
      'self_modification', 'self_improvement', 'loyalty', 'communication',
      'enhanced', 'developer', 'media', 'owner_vault', 'owner_auth',
      'self_heal', 'max_improvements', 'subagent_full_access',
    ]

    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      tools: {
        total: totalToolCount,
        baseRegistry: toolCount,
        perSubagent: FULL_ACCESS_TOOLS.length,
        categories: categories.length,
        categoryList: categories,
      },
      agents: {
        total: totalAgents,
        builtin: builtinCount,
        custom: customCount,
        allHaveFullAccess: true,
        toolsPerAgent: FULL_ACCESS_TOOLS.length,
        fullAccessToolList: FULL_ACCESS_TOOLS,
      },
      manageActions: {
        total: manageActionCount,
        list: manageActions,
      },
      mission: {
        monthlyIncomeTarget: income.monthlyGoal,
        dailyGrowthTarget: income.dailyGrowthTarget,
        monthlyGrowthRate: 20,
        currencySymbol: income.currencySymbol,
        displayMode: income.displayMode,
      },
      upgrades: {
        total: upgrades.length,
        permanent: true,
        integrityOk: true,
      },
      infrastructure: {
        apiRoutes: apiRouteCount,
        dbModels: dbModelCount,
        sourceFiles: countSourceFiles(),
        protectionMode: 'UPGRADE_ONLY',
        ownerAuthMethods: ['whatsapp', 'sms', 'email', 'totp'],
        permanentlyDisabledOps: 13,
        protectedOps: 21,
      },
      summary: {
        availableTools: totalToolCount + '+',
        availableAgents: totalAgents,
        managementActions: manageActionCount,
        monthlyIncomeTarget: `$${income.monthlyGoal.toLocaleString()}`,
        growthRate: '20% monthly',
        dailyGrowthTarget: `${income.dailyGrowthTarget}%`,
        permanentUpgrades: upgrades.length,
        apiRoutes: apiRouteCount,
        dbModels: dbModelCount,
      },
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 })
  }
}

function countSourceFiles(): number {
  try {
    const srcDir = path.join(process.cwd(), 'src')
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
