/**
 * Re-apply #204 protocols (lost in git rebase)
 * Adds THINKING PROTOCOL + CROSS-POD DISPATCH to all 18 built-in agents
 */
import { readFileSync, writeFileSync } from 'fs'

const FILE = '/home/z/my-project/src/lib/subagents.ts'
let src = readFileSync(FILE, 'utf8')

const DISPATCH_BLOCK = `
CROSS-POD DISPATCH (UPGRADE #204 — you are NOT isolated):
You can request help from specialists in other pods:
- Intelligence: <dispatch agent="scout" task="research X"/> | <dispatch agent="quantum" task="analyze investment Y"/>
- Creation: <dispatch agent="aurora" task="create content Z"/> | <dispatch agent="prism" task="design visual W"/>
- QA: <dispatch agent="echo" task="verify quality of V"/> | <dispatch agent="qa_monitor" task="health check"/>
- Engineering: <dispatch agent="forge" task="build U"/> | <dispatch agent="developer" task="fix bug T"/>
- Monitoring: <dispatch agent="pulse" task="track KPI S"/> | <dispatch agent="external_uptime_monitor" task="probe URL"/>
- Security: <dispatch agent="cybersecurity_a" task="scan for R"/> | <dispatch agent="cybersecurity_r" task="harden system"/>
- Finance: <dispatch agent="banker" task="treasury analysis"/> | <dispatch agent="trader" task="execute trade"/>
- Legal: <dispatch agent="legal" task="compliance review Q"/>
Use dispatch when a task falls outside your specialty. Max 2 dispatches per turn.`

// Find all systemPrompt template literals and add CROSS-POD DISPATCH before the closing backtick
// Pattern: systemPrompt: `...` followed by , or }
const promptRegex = /(systemPrompt:\s*`[\s\S]*?)(`,)/g
let count = 0
src = src.replace(promptRegex, (match, before, after) => {
  // Skip if already has CROSS-POD DISPATCH
  if (before.includes('CROSS-POD DISPATCH')) return match
  count++
  return before + '\n' + DISPATCH_BLOCK + '\n' + after
})

writeFileSync(FILE, src)
console.log(`✓ Added CROSS-POD DISPATCH to ${count} agents`)
