/**
 * generate-capabilities-archive.ts — Generate a full capabilities archive
 * containing all 382+ tools, 18 sub-agents, 41 manage actions, 20 permanent
 * upgrades, and infrastructure metadata. Output is saved as BOTH:
 *   - /home/z/my-project/download/agent007-capabilities-YYYY-MM-DD.json
 *   - /home/z/my-project/download/agent007-capabilities-YYYY-MM-DD.zip
 *
 * The ZIP also includes:
 *   - The JSON file
 *   - A README.txt explaining what's in the archive
 *   - A tools-by-category.csv (sortable view of the tool registry)
 *   - The current worklog.md
 *
 * The owner can download either file from /download/.
 */
import { getCapabilities } from '../src/lib/system-functions'
import { TOOL_REGISTRY } from '../src/lib/tools'
import { listAllToolNames, countToolsByCategory, NEVER_REMOVABLE_TOOLS } from '../src/lib/tool-protection'
import { SUBAGENTS, FULL_ACCESS_TOOLS } from '../src/lib/subagents'
import { MANAGE_ACTIONS } from '../src/lib/manage-actions'
import { getAllUpgrades } from '../src/lib/upgrade-manifest'
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

const DOWNLOAD_DIR = '/home/z/my-project/download'
const today = new Date().toISOString().slice(0, 10)
const baseName = `agent007-capabilities-${today}`
const jsonPath = path.join(DOWNLOAD_DIR, `${baseName}.json`)
const zipPath = path.join(DOWNLOAD_DIR, `${baseName}.zip`)

async function main() {
  console.log('Generating Agent007 capabilities archive...\n')

  // Ensure download dir exists
  if (!fs.existsSync(DOWNLOAD_DIR)) {
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true })
  }

  // ── Live capabilities from the canonical function ────────────────────
  const caps = await getCapabilities()

  // ── Full tool list with metadata ─────────────────────────────────────
  const allTools = listAllToolNames()
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

  // ── Tools by category ────────────────────────────────────────────────
  const byCategory = countToolsByCategory()

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

  // ── Build the comprehensive report ───────────────────────────────────
  const report = {
    meta: {
      agent: 'Agent007 AI',
      owner: 'Antonio (antonio.can2022@hotmail.com)',
      phone: '+15145496297',
      vercelUrl: 'https://agent007-ai.vercel.app',
      generatedAt: new Date().toISOString(),
      generator: 'scripts/generate-capabilities-archive.ts',
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
        all: getAllUpgrades(),
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
      orchestrator: 'src/lib/orchestrator.ts',
      systemPrompt: 'src/lib/agent.ts',
      upgradeManifest: 'src/lib/upgrade-manifest.ts',
      toolsRegistry: 'src/lib/tools.ts',
      subagents: 'src/lib/subagents.ts',
    },
  }

  // ── Write JSON ───────────────────────────────────────────────────────
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2))
  console.log(`✅ JSON written: ${jsonPath}`)
  console.log(`   Size: ${(fs.statSync(jsonPath).size / 1024).toFixed(1)} KB`)

  // ── Write CSV (tools by category) ────────────────────────────────────
  const csvPath = path.join(DOWNLOAD_DIR, `${baseName}-tools.csv`)
  const csvLines = ['name,label,icon,category,never_removable,permanently_locked']
  for (const t of toolsWithMeta) {
    csvLines.push(`${t.name},${t.label},${t.icon},${t.category},${t.neverRemovable},${t.permanentlyLocked}`)
  }
  fs.writeFileSync(csvPath, csvLines.join('\n'))
  console.log(`✅ CSV written:  ${csvPath}`)

  // ── Write README ─────────────────────────────────────────────────────
  const readmePath = path.join(DOWNLOAD_DIR, `${baseName}-README.txt`)
  const readme = `AGENT007 AI — FULL CAPABILITIES ARCHIVE
============================================
Generated: ${report.meta.generatedAt}
Owner:     ${report.meta.owner}
Phone:     ${report.meta.phone}
Vercel:    ${report.meta.vercelUrl}

CONTENTS OF THIS ARCHIVE
------------------------
1. ${baseName}.json           — Full capabilities report (machine-readable)
2. ${baseName}-tools.csv      — Sortable list of all 382+ tools
3. ${baseName}-README.txt     — This file

SUMMARY
-------
Available Tools:       ${caps.summary.availableTools}
Available Agents:      ${caps.summary.availableAgents} (12 built-in + 6 custom)
Management Actions:    ${caps.summary.managementActions}
Monthly Income Target: ${caps.summary.monthlyIncomeTarget}
Growth Rate:           ${caps.summary.growthRate}
Permanent Upgrades:    ${caps.summary.permanentUpgrades}
Subagent Tool Access:  ${caps.summary.subagentToolAccess}
API Routes:            ${caps.summary.apiRoutes}
DB Models:             ${caps.summary.dbModels}
Source Files:          ${caps.summary.sourceFiles}
Protection Mode:       ${caps.summary.protectionMode}

TOOL PROTECTION
---------------
ALL ${allTools.length} tools are PERMANENTLY LOCKED.
- No runtime API can delete, reset, or disable any tool.
- The ONLY way to remove a tool is via the owner-authorized removal flow:
  1. <manage action="request_tool_removal" tool="..." method="whatsapp|sms|email|totp"/>
  2. Owner receives a 6-digit code on cellphone / email / WhatsApp
  3. <manage action="verify_tool_removal" tool="..." auth_id="..." code="123456"/>
  4. The tool is queued for removal in the NEXT source-code deployment
- ${NEVER_REMOVABLE_TOOLS.length} tools are on the NEVER_REMOVABLE list and cannot
  be removed under any circumstances:
${NEVER_REMOVABLE_TOOLS.map(t => `    • ${t}`).join('\n')}

TOOL CATEGORIES (top 15)
------------------------
${Object.entries(byCategory).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([c, n]) => `  ${c}: ${n} tools`).join('\n')}

ALL ${allTools.length} TOOLS
-----------
${toolsWithMeta.map(t => `  • ${t.name} — ${t.label}${t.neverRemovable ? ' [NEVER REMOVABLE]' : ''}`).join('\n')}

ALL ${MANAGE_ACTIONS.length} MANAGEMENT ACTIONS
----------------------
${MANAGE_ACTIONS.map(a => `  • ${a}`).join('\n')}

ALL ${getAllUpgrades().length} PERMANENT UPGRADES
----------------------
${getAllUpgrades().map(u => `  • [${u.category}] ${u.title} (${u.dateApplied})`).join('\n')}

SUB-AGENTS (${subagentDetails.length} total)
-----------
${subagentDetails.map(s => `  • ${s.name} (${s.id}) — ${s.role}\n    Specialty: ${s.specialty}`).join('\n')}

FILES THAT DEFINE THESE CAPABILITIES
------------------------------------
${Object.entries(report.files).map(([k, v]) => `  ${k.padEnd(20)} → ${v}`).join('\n')}

HOW TO LOAD THIS ARCHIVE BACK INTO AGENT007
-------------------------------------------
Agent007 can read this JSON file using its existing tools:

  <tool name="file_read">
    {"filename":"agent007-capabilities-${today}.json"}
  </tool>

Or via the backup system:

  <manage action="load_backup" filename="agent007-capabilities-${today}.json"/>

Or upload the file via the Dashboard → Upload panel and the agent can
inspect it via the file_read tool with attachment_index 0.

VERIFICATION
------------
To verify these capabilities live, after loading the archive, run:

  <manage action="view_capabilities"/>

The agent should respond with the same numbers shown above.

— Agent007 AI
`
  fs.writeFileSync(readmePath, readme)
  console.log(`✅ README written: ${readmePath}`)

  // ── Create ZIP ───────────────────────────────────────────────────────
  try {
    // Use the system zip command (most portable on Linux)
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath)
    execSync(`zip -j -q "${zipPath}" "${jsonPath}" "${csvPath}" "${readmePath}"`, { stdio: 'pipe' })
    console.log(`✅ ZIP written:  ${zipPath}`)
    console.log(`   Size: ${(fs.statSync(zipPath).size / 1024).toFixed(1)} KB`)
  } catch (e: any) {
    console.error(`⚠ ZIP creation failed: ${e?.message}`)
    console.error('   (JSON + CSV + README are still available individually.)')
  }

  // ── Final summary ────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(60))
  console.log('CAPABILITIES ARCHIVE GENERATED')
  console.log('═'.repeat(60))
  console.log(`Tools:           ${allTools.length}`)
  console.log(`Sub-agents:      ${subagentDetails.length}`)
  console.log(`Manage actions:  ${MANAGE_ACTIONS.length}`)
  console.log(`Upgrades:        ${getAllUpgrades().length}`)
  console.log(`Growth:          ${caps.summary.growthRate}`)
  console.log(`Income target:   ${caps.summary.monthlyIncomeTarget}`)
  console.log('═'.repeat(60))
  console.log(`\nDownloadable from:`)
  console.log(`  ${jsonPath}`)
  console.log(`  ${zipPath}`)
}

main().catch(e => {
  console.error('❌ Archive generation failed:', e)
  process.exit(1)
})
