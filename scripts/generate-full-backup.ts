/**
 * generate-full-backup.ts — Generates a complete backup of ALL Agent007
 * capabilities as both JSON and ZIP files, saved to /download/ for
 * the owner to download.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { execSync } from 'node:child_process'

// Import all the registry data
import { TOOL_REGISTRY } from '/home/z/my-project/src/lib/tools'
import { NEVER_REMOVABLE_TOOLS, EXECUTION_PROTECTED_TOOLS, countAllTools } from '/home/z/my-project/src/lib/tool-protection'
import { SUBAGENTS } from '/home/z/my-project/src/lib/subagents'
import { UPGRADE_MANIFEST } from '/home/z/my-project/src/lib/upgrade-manifest'
import { MANAGE_ACTIONS, MANAGE_ACTION_COUNT } from '/home/z/my-project/src/lib/manage-actions'

const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
const dateStr = new Date().toISOString().split('T')[0]

console.log('═══════════════════════════════════════════════════════════════')
console.log('  AGENT007 — FULL BACKUP GENERATOR')
console.log('═══════════════════════════════════════════════════════════════')
console.log(`Timestamp: ${timestamp}`)
console.log()

// Build the complete capabilities snapshot
const backup = {
  metadata: {
    app: 'Agent007 AI',
    version: '5.0',
    timestamp: new Date().toISOString(),
    date: dateStr,
    owner: 'Antonio (antonio.can2022@hotmail.com, +15145496297)',
    mission: {
      monthlyIncomeTarget: 20000,
      monthlyGrowthRate: 20,
      dailyGrowthTarget: 20,
    },
    deployment: {
      url: 'https://agent007-ai.vercel.app',
      platform: 'Vercel',
      framework: 'Next.js 16',
    },
  },

  capabilities: {
    totalTools: countAllTools(),
    totalAgents: SUBAGENTS.length,
    manageActions: MANAGE_ACTION_COUNT,
    neverRemovableTools: NEVER_REMOVABLE_TOOLS.length,
    executionProtectedTools: EXECUTION_PROTECTED_TOOLS.length,
    permanentUpgrades: UPGRADE_MANIFEST.length,
  },

  tools: {
    total: Object.keys(TOOL_REGISTRY).length,
    allTools: Object.keys(TOOL_REGISTRY).sort(),
    byCategory: Object.entries(
      Object.keys(TOOL_REGISTRY).reduce((cats: Record<string, string[]>, name) => {
        const idx = name.indexOf('_')
        const cat = idx > 0 ? name.slice(0, idx) : 'core'
        if (!cats[cat]) cats[cat] = []
        cats[cat].push(name)
        return cats
      }, {})
    ).sort((a, b) => b[1].length - a[1].length).map(([cat, tools]) => ({ category: cat, count: tools.length, tools })),
    toolDetails: Object.entries(TOOL_REGISTRY).map(([name, entry]: [string, any]) => ({
      name,
      label: entry.label,
      icon: entry.icon,
      neverRemovable: NEVER_REMOVABLE_TOOLS.includes(name),
    })),
  },

  agents: {
    total: SUBAGENTS.length,
    allBuiltin: SUBAGENTS.every(a => a.isBuiltin),
    allEnabled: SUBAGENTS.every(a => a.enabled),
    agents: SUBAGENTS.map(a => ({
      id: a.id,
      name: a.name,
      role: a.role,
      specialty: a.specialty,
      color: a.color,
      icon: a.icon,
      isBuiltin: a.isBuiltin,
      enabled: a.enabled,
      hasMaxPerformanceProtocol: a.systemPrompt.includes('MAX-PERFORMANCE PROTOCOL'),
      hasAISearchEngines: a.systemPrompt.includes('AI SEARCH ENGINES'),
      hasSmartToolRouter: a.systemPrompt.includes('smart_tool_router'),
      promptLength: a.systemPrompt.length,
    })),
  },

  manageActions: {
    total: MANAGE_ACTION_COUNT,
    actions: MANAGE_ACTIONS,
  },

  upgrades: {
    total: UPGRADE_MANIFEST.length,
    allPermanent: UPGRADE_MANIFEST.every(u => u.permanent),
    upgrades: UPGRADE_MANIFEST.map(u => ({
      id: u.id,
      category: u.category,
      title: u.title,
      dateApplied: u.dateApplied,
      permanent: u.permanent,
      files: u.files,
    })),
  },

  protection: {
    neverRemovableCount: NEVER_REMOVABLE_TOOLS.length,
    executionProtectedCount: EXECUTION_PROTECTED_TOOLS.length,
    executionProtectedTools: [...EXECUTION_PROTECTED_TOOLS],
    permanentAgentNames: ['trader', 'cybersecurity_a', 'cybersecurity_r', 'developer', 'testfast2', 'fasttest3'],
    builtinAgentIds: SUBAGENTS.map(a => a.id),
  },

  settings: {
    monthlyIncomeTarget: 20000,
    monthlyGrowthRate: 20,
    dailyGrowthTarget: 20,
    currencySymbol: '$',
    displayMode: 'detailed',
    smtpConfigured: true,
    emailProvider: 'Resend.com',
    twoFactorRequired: true,
    ownerEmail: 'antonio.can2022@hotmail.com',
    ownerPhone: '+15145496297',
  },

  summary: {
    totalTools: Object.keys(TOOL_REGISTRY).length,
    totalAgents: SUBAGENTS.length,
    totalUpgrades: UPGRADE_MANIFEST.length,
    totalManageActions: MANAGE_ACTION_COUNT,
    allToolsLocked: NEVER_REMOVABLE_TOOLS.length === Object.keys(TOOL_REGISTRY).length,
    allAgentsLocked: SUBAGENTS.every(a => a.isBuiltin),
    allUpgradesPermanent: UPGRADE_MANIFEST.every(u => u.permanent),
  },
}

// Save JSON
const downloadDir = '/home/z/my-project/download'
if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true })

const jsonFile = path.join(downloadDir, `agent007-full-backup-${dateStr}.json`)
fs.writeFileSync(jsonFile, JSON.stringify(backup, null, 2))
console.log(`✅ JSON backup saved: ${jsonFile}`)
console.log(`   Size: ${(fs.statSync(jsonFile).size / 1024).toFixed(1)} KB`)

// Save a copy with a stable name
const jsonStable = path.join(downloadDir, 'agent007-full-backup-latest.json')
fs.writeFileSync(jsonStable, JSON.stringify(backup, null, 2))
console.log(`✅ JSON backup (stable name): ${jsonStable}`)

// Create ZIP (using gzip for JSON compression + a zip using tar)
const gzipFile = path.join(downloadDir, `agent007-full-backup-${dateStr}.json.gz`)
execSync(`gzip -c "${jsonFile}" > "${gzipFile}"`)
console.log(`✅ GZIP backup saved: ${gzipFile}`)
console.log(`   Size: ${(fs.statSync(gzipFile).size / 1024).toFixed(1)} KB`)

const gzipStable = path.join(downloadDir, 'agent007-full-backup-latest.json.gz')
fs.copyFileSync(gzipFile, gzipStable)
console.log(`✅ GZIP backup (stable name): ${gzipStable}`)

// Try to create a real ZIP using Python
const zipFile = path.join(downloadDir, `agent007-full-backup-${dateStr}.zip`)
try {
  execSync(`python3 -c "
import zipfile, json
with open('${jsonFile}', 'r') as f:
    data = json.load(f)
with zipfile.ZipFile('${zipFile}', 'w', zipfile.ZIP_DEFLATED) as zf:
    zf.write('${jsonFile}', 'agent007-full-backup-${dateStr}.json')
print('ZIP created')
"`)
  console.log(`✅ ZIP backup saved: ${zipFile}`)
  console.log(`   Size: ${(fs.statSync(zipFile).size / 1024).toFixed(1)} KB`)

  const zipStable = path.join(downloadDir, 'agent007-full-backup-latest.zip')
  fs.copyFileSync(zipFile, zipStable)
  console.log(`✅ ZIP backup (stable name): ${zipStable}`)
} catch (e: any) {
  console.log(`⚠️  ZIP creation failed (gzip available as fallback): ${e?.message}`)
}

console.log()
console.log('═══════════════════════════════════════════════════════════════')
console.log('  BACKUP SUMMARY')
console.log('═══════════════════════════════════════════════════════════════')
console.log(`  Tools: ${backup.capabilities.totalTools}`)
console.log(`  Agents: ${backup.capabilities.totalAgents}`)
console.log(`  Manage Actions: ${backup.capabilities.manageActions}`)
console.log(`  Upgrades: ${backup.capabilities.permanentUpgrades}`)
console.log(`  Never-Removable Tools: ${backup.capabilities.neverRemovableTools}`)
console.log(`  Execution-Protected Tools: ${backup.capabilities.executionProtectedTools}`)
console.log(`  All tools locked: ${backup.summary.allToolsLocked ? '✅' : '❌'}`)
console.log(`  All agents locked: ${backup.summary.allAgentsLocked ? '✅' : '❌'}`)
console.log(`  All upgrades permanent: ${backup.summary.allUpgradesPermanent ? '✅' : '❌'}`)
console.log()
console.log('  FILES GENERATED:')
console.log(`    📄 ${jsonFile}`)
console.log(`    📦 ${gzipFile}`)
if (fs.existsSync(zipFile)) console.log(`    📦 ${zipFile}`)
console.log()
console.log('  DOWNLOAD URLS (available on Vercel after deploy):')
console.log('    JSON: https://agent007-ai.vercel.app/api/system/backup-download?label=full-backup&format=json')
console.log('    ZIP:  https://agent007-ai.vercel.app/api/system/backup-download?label=full-backup')
console.log('    Caps: https://agent007-ai.vercel.app/api/system/capabilities-download?format=zip')
console.log('═══════════════════════════════════════════════════════════════')
