/**
 * PATCH SUBAGENTS — Add the 4 critical tools (page_reader, accuracy_checker,
 * quality_scorer_v2, failure_learning) to every agent that's missing them.
 *
 * This implements Recommendation #1 from the deep team audit:
 * "ADD MISSING CRITICAL TOOLS to all agents"
 *
 * Run: npx tsx /home/z/my-project/scripts/patch-subagents-critical-tools.ts
 */
import { readFileSync, writeFileSync } from 'fs'

const FILE = '/home/z/my-project/src/lib/subagents.ts'
const CRITICAL_TOOLS = ['page_reader', 'accuracy_checker', 'quality_scorer_v2', 'failure_learning']

const src = readFileSync(FILE, 'utf8')

// Find all allowedTools arrays in built-in subagent definitions
// Pattern: allowedTools: ['tool1','tool2',...],
const allowedToolsRegex = /allowedTools:\s*\[([^\]]+)\]/g

let patchCount = 0
let totalAdded = 0

const patched = src.replace(allowedToolsRegex, (match, toolsContent) => {
  // Skip if this is a spread operator (e.g. [...FULL_ACCESS_TOOLS]) — custom agents have all tools
  if (toolsContent.includes('...')) return match

  // Parse existing tools
  const existingTools = toolsContent
    .split(',')
    .map(t => t.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)

  // Find which critical tools are missing
  const missing = CRITICAL_TOOLS.filter(t => !existingTools.includes(t))

  if (missing.length === 0) return match

  // Add missing tools
  const newTools = [...existingTools, ...missing]
  patchCount++
  totalAdded += missing.length

  // Reconstruct the array
  const newContent = newTools.map(t => `'${t}'`).join(',')
  return `allowedTools: [${newContent}]`
})

writeFileSync(FILE, patched)

console.log(`✓ Patched ${patchCount} agents`)
console.log(`✓ Added ${totalAdded} missing critical tools`)
console.log(`✓ File: ${FILE}`)

// Verify
const verifySrc = readFileSync(FILE, 'utf8')
const verifyMatches = verifySrc.match(/allowedTools:\s*\[([^\]]+)\]/g) || []
let stillMissing = 0
for (const m of verifyMatches) {
  if (m.includes('...')) continue
  for (const t of CRITICAL_TOOLS) {
    if (!m.includes(t)) {
      stillMissing++
      console.log(`  ⚠️  Still missing ${t} in: ${m.slice(0, 80)}...`)
    }
  }
}
if (stillMissing === 0) {
  console.log('✓ All built-in agents now have all 4 critical tools')
} else {
  console.log(`⚠️  ${stillMissing} gaps remain`)
}
