import { NextRequest, NextResponse } from 'next/server'
import { getCapabilities } from '@/lib/system-functions'
import { TOOL_REGISTRY } from '@/lib/tools'
import { SUBAGENTS, FULL_ACCESS_TOOLS } from '@/lib/subagents'
import { MANAGE_ACTIONS } from '@/lib/manage-actions'
import { getAllUpgrades } from '@/lib/upgrade-manifest'
import { NEVER_REMOVABLE_TOOLS, listAllToolNames, countToolsByCategory } from '@/lib/tool-protection'
import { createGzip } from 'node:zlib'
import { Readable } from 'node:stream'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * /api/system/capabilities-download
 *
 * On-demand capabilities archive generator. Returns the full 382+ tool
 * registry, 18 sub-agents, 41 manage actions, 22+ permanent upgrades, and
 * infrastructure metadata as a downloadable file.
 *
 * WHY ON-DEMAND?
 *   Vercel's /tmp storage is EPHEMERAL. A pre-generated file in
 *   /home/z/my-project/download/ doesn't exist on Vercel. So we
 *   REGENERATE the archive at request time and stream it directly to
 *   the client. No persistent storage needed.
 *
 * QUERY PARAMS
 *   ?format=json    → raw JSON file (default)
 *   ?format=zip     → gzipped JSON (smaller, faster download)
 *   ?format=csv     → CSV of all 382+ tools (sortable in Excel)
 *   ?format=readme  → human-readable README.txt
 *   (no param)      → defaults to zip
 *
 * USAGE FROM AGENT007
 *   <manage action="view_capabilities"/> — see live numbers in chat
 *   Direct download URL: /api/system/capabilities-download?format=zip
 *   The agent can also use file_read on the JSON if it's uploaded.
 */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const format = (url.searchParams.get('format') ?? 'zip').toLowerCase()
    const today = new Date().toISOString().slice(0, 10)
    const baseName = `agent007-capabilities-${today}`

    // ── Live capabilities (canonical source) ─────────────────────────────
    const caps = await getCapabilities()
    const allTools = listAllToolNames()
    const byCategory = countToolsByCategory()
    const upgrades = getAllUpgrades()

    // ── Tool list with metadata ──────────────────────────────────────────
    const toolsWithMeta = allTools.map(name => {
      const entry = (TOOL_REGISTRY as any)[name]
      return {
        name,
        label: entry?.label ?? name,
        icon: entry?.icon ?? 'Wrench',
        category: name.includes('_') ? name.slice(0, name.indexOf('_')) : 'core',
        neverRemovable: NEVER_REMOVABLE_TOOLS.includes(name),
        permanentlyLocked: true,
      }
    })

    // ── Sub-agent details ────────────────────────────────────────────────
    const subagentDetails = SUBAGENTS.map(s => ({
      id: s.id,
      name: s.name,
      role: s.role,
      specialty: s.specialty,
      color: s.color,
      icon: s.icon,
      isBuiltin: s.isBuiltin ?? true,
      enabled: s.enabled ?? true,
      fullAccess: true,
      toolCount: FULL_ACCESS_TOOLS.length,
      tools: FULL_ACCESS_TOOLS,
    }))

    // ── Full report object ───────────────────────────────────────────────
    const report = {
      meta: {
        agent: 'Agent007 AI',
        owner: 'Antonio (antonio.can2022@hotmail.com)',
        phone: '+15145496297',
        vercelUrl: 'https://agent007-ai.vercel.app',
        generatedAt: new Date().toISOString(),
        generator: '/api/system/capabilities-download (on-demand)',
        format: 'agent007-capabilities-v1',
      },
      summary: caps.summary,
      capabilities: {
        tools: {
          ...caps.tools,
          all: toolsWithMeta,
          byCategory,
          neverRemovable: Array.from(NEVER_REMOVABLE_TOOLS),
          protectionLayer: 'src/lib/tool-protection.ts',
          protectionMode: 'ALL_TOOLS_PERMANENTLY_LOCKED',
          removalRequires: 'owner_authorization_via_cellphone_email_or_whatsapp',
        },
        agents: {
          ...caps.agents,
          details: subagentDetails,
        },
        manageActions: {
          ...caps.manageActions,
          newToolProtectionActions: ['list_tools', 'request_tool_removal', 'verify_tool_removal'],
        },
        mission: caps.mission,
        upgrades: {
          ...caps.upgrades,
          all: upgrades,
        },
        infrastructure: {
          apiRoutes: caps.summary.apiRoutes,
          dbModels: caps.summary.dbModels,
          sourceFiles: caps.summary.sourceFiles,
          protectionMode: caps.summary.protectionMode,
          permanentlyDisabledOps: caps.summary.permanentlyDisabledOps,
          protectedOps: caps.summary.protectedOps,
        },
      },
      files: {
        toolProtection: 'src/lib/tool-protection.ts',
        manageActionsList: 'src/lib/manage-actions.ts',
        systemFunctions: 'src/lib/system-functions.ts',
        backupFunctions: 'src/lib/backup-functions.ts',
        orchestrator: 'src/lib/orchestrator.ts',
        systemPrompt: 'src/lib/agent.ts',
        upgradeManifest: 'src/lib/upgrade-manifest.ts',
        toolsRegistry: 'src/lib/tools.ts',
        subagents: 'src/lib/subagents.ts',
        dbInit: 'src/lib/db.ts',
      },
    }

    const jsonContent = JSON.stringify(report, null, 2)

    // ── Format routing ───────────────────────────────────────────────────
    if (format === 'json') {
      return new NextResponse(jsonContent, {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="${baseName}.json"`,
          'Content-Length': String(Buffer.byteLength(jsonContent, 'utf-8')),
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
      })
    }

    if (format === 'csv') {
      const csvLines = ['name,label,icon,category,never_removable,permanently_locked']
      for (const t of toolsWithMeta) {
        // Escape labels that contain commas
        const safeLabel = t.label.includes(',')
          ? `"${t.label.replace(/"/g, '""')}"`
          : t.label
        csvLines.push(`${t.name},${safeLabel},${t.icon},${t.category},${t.neverRemovable},${t.permanentlyLocked}`)
      }
      const csvContent = csvLines.join('\n')
      return new NextResponse(csvContent, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${baseName}-tools.csv"`,
          'Content-Length': String(Buffer.byteLength(csvContent, 'utf-8')),
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
      })
    }

    if (format === 'readme') {
      const readme = buildReadme(report, toolsWithMeta, byCategory, subagentDetails, upgrades, allTools.length)
      return new NextResponse(readme, {
        status: 200,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Disposition': `attachment; filename="${baseName}-README.txt"`,
          'Content-Length': String(Buffer.byteLength(readme, 'utf-8')),
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
      })
    }

    // ── Default: zip (gzipped JSON) ──────────────────────────────────────
    // Use Node's built-in zlib to gzip the JSON, then stream it back.
    // Vercel doesn't have the `zip` binary, but zlib is built into Node.
    const jsonBuffer = Buffer.from(jsonContent, 'utf-8')
    const gzippedBuffer = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = []
      const gzipStream = createGzip()
      gzipStream.on('data', (chunk: Buffer) => chunks.push(chunk))
      gzipStream.on('end', () => resolve(Buffer.concat(chunks)))
      gzipStream.on('error', reject)
      Readable.from(jsonBuffer).pipe(gzipStream)
    })

    // Convert Buffer to Uint8Array for NextResponse (BodyInit compatibility)
    const responseBuffer = new Uint8Array(gzippedBuffer)

    return new NextResponse(responseBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/gzip',
        'Content-Disposition': `attachment; filename="${baseName}.json.gz"`,
        'Content-Length': String(gzippedBuffer.length),
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'X-Capabilities-Tools': String(allTools.length),
        'X-Capabilities-Agents': String(subagentDetails.length),
        'X-Capabilities-Actions': String(MANAGE_ACTIONS.length),
        'X-Capabilities-Upgrades': String(upgrades.length),
      },
    })
  } catch (e: any) {
    console.error('[capabilities-download] failed:', e)
    return NextResponse.json(
      { ok: false, error: e?.message ?? String(e), stack: e?.stack },
      { status: 500 }
    )
  }
}

/**
 * Build a human-readable README with all the capabilities.
 */
function buildReadme(
  report: any,
  tools: Array<{ name: string; label: string; icon: string; category: string; neverRemovable: boolean; permanentlyLocked: boolean }>,
  byCategory: Record<string, number>,
  subagents: any[],
  upgrades: any[],
  totalTools: number
): string {
  const lines: string[] = []
  lines.push('AGENT007 AI — FULL CAPABILITIES ARCHIVE')
  lines.push('============================================')
  lines.push(`Generated: ${report.meta.generatedAt}`)
  lines.push(`Owner:     ${report.meta.owner}`)
  lines.push(`Phone:     ${report.meta.phone}`)
  lines.push(`Vercel:    ${report.meta.vercelUrl}`)
  lines.push('')
  lines.push('SUMMARY')
  lines.push('-------')
  lines.push(`Available Tools:       ${report.summary.availableTools}`)
  lines.push(`Available Agents:      ${report.summary.availableAgents}`)
  lines.push(`Management Actions:    ${report.summary.managementActions}`)
  lines.push(`Monthly Income Target: ${report.summary.monthlyIncomeTarget}`)
  lines.push(`Growth Rate:           ${report.summary.growthRate}`)
  lines.push(`Permanent Upgrades:    ${report.summary.permanentUpgrades}`)
  lines.push(`Subagent Tool Access:  ${report.summary.subagentToolAccess}`)
  lines.push(`API Routes:            ${report.summary.apiRoutes}`)
  lines.push(`DB Models:             ${report.summary.dbModels}`)
  lines.push(`Source Files:          ${report.summary.sourceFiles}`)
  lines.push(`Protection Mode:       ${report.summary.protectionMode}`)
  lines.push('')
  lines.push('TOOL PROTECTION')
  lines.push('---------------')
  lines.push(`ALL ${totalTools} tools are PERMANENTLY LOCKED.`)
  lines.push('- No runtime API can delete, reset, or disable any tool.')
  lines.push('- The ONLY way to remove a tool is via the owner-authorized removal flow:')
  lines.push('  1. <manage action="request_tool_removal" tool="..." method="whatsapp|sms|email|totp"/>')
  lines.push('  2. Owner receives a 6-digit code on cellphone / email / WhatsApp')
  lines.push('  3. <manage action="verify_tool_removal" tool="..." auth_id="..." code="123456"/>')
  lines.push('  4. The tool is queued for removal in the NEXT source-code deployment')
  lines.push(`- ${NEVER_REMOVABLE_TOOLS.length} tools are on the NEVER_REMOVABLE list:`)
  for (const t of NEVER_REMOVABLE_TOOLS) {
    lines.push(`    • ${t}`)
  }
  lines.push('')
  lines.push('TOOL CATEGORIES (top 20)')
  lines.push('------------------------')
  const sortedCats = Object.entries(byCategory).sort((a, b) => b[1] - a[1]).slice(0, 20)
  for (const [cat, n] of sortedCats) {
    lines.push(`  ${cat}: ${n} tools`)
  }
  lines.push('')
  lines.push(`ALL ${totalTools} TOOLS`)
  lines.push('-----------')
  for (const t of tools) {
    const flag = t.neverRemovable ? ' [NEVER REMOVABLE]' : ''
    lines.push(`  • ${t.name} — ${t.label}${flag}`)
  }
  lines.push('')
  lines.push(`ALL ${MANAGE_ACTIONS.length} MANAGEMENT ACTIONS`)
  lines.push('----------------------')
  for (const a of MANAGE_ACTIONS) {
    lines.push(`  • ${a}`)
  }
  lines.push('')
  lines.push(`ALL ${upgrades.length} PERMANENT UPGRADES`)
  lines.push('----------------------')
  for (const u of upgrades) {
    lines.push(`  • [${u.category}] ${u.title} (${u.dateApplied})`)
  }
  lines.push('')
  lines.push(`SUB-AGENTS (${subagents.length} total)`)
  lines.push('-----------')
  for (const s of subagents) {
    lines.push(`  • ${s.name} (${s.id}) — ${s.role}`)
    lines.push(`    Specialty: ${s.specialty}`)
  }
  lines.push('')
  lines.push('FILES THAT DEFINE THESE CAPABILITIES')
  lines.push('------------------------------------')
  for (const [k, v] of Object.entries(report.files)) {
    lines.push(`  ${k.padEnd(20)} → ${v}`)
  }
  lines.push('')
  lines.push('HOW TO DOWNLOAD IN OTHER FORMATS')
  lines.push('---------------------------------')
  lines.push('  ?format=zip     → gzipped JSON (default, smallest)')
  lines.push('  ?format=json    → raw JSON')
  lines.push('  ?format=csv     → CSV of all tools (sortable in Excel)')
  lines.push('  ?format=readme  → this human-readable file')
  lines.push('')
  lines.push('HOW TO LOAD THIS ARCHIVE BACK INTO AGENT007')
  lines.push('-------------------------------------------')
  lines.push('Upload the JSON file via the dashboard upload panel, then:')
  lines.push('  <tool name="file_read">{"filename":"agent007-capabilities-...json"}</tool>')
  lines.push('')
  lines.push('VERIFICATION')
  lines.push('------------')
  lines.push('To verify these capabilities live, run:')
  lines.push('  <manage action="view_capabilities"/>')
  lines.push('')
  lines.push('— Agent007 AI')
  return lines.join('\n')
}
