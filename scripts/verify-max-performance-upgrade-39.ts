/**
 * verify-max-performance-upgrade-39.ts
 * Verifies all 6 enhanced agents + the new subagent_performance_monitor tool.
 */
import { dispatchTool, TOOL_REGISTRY } from '/home/z/my-project/src/lib/tools'
import { NEVER_REMOVABLE_TOOLS } from '/home/z/my-project/src/lib/tool-protection'
import { SUBAGENTS } from '/home/z/my-project/src/lib/subagents'

const ctx = { attachments: [], language: 'en' as const }

console.log('═══════════════════════════════════════════════════════════════')
console.log('  Agent007 — Upgrade #39 Max-Performance Verification')
console.log('═══════════════════════════════════════════════════════════════')
console.log(`Total tools in registry: ${Object.keys(TOOL_REGISTRY).length}`)
console.log(`NEVER_REMOVABLE count: ${NEVER_REMOVABLE_TOOLS.length}`)
console.log()

// Verify subagent_performance_monitor tool exists + works
console.log('=== New Tool Verification ===')
const toolName = 'subagent_performance_monitor'
const exists = !!TOOL_REGISTRY[toolName]
const isLocked = NEVER_REMOVABLE_TOOLS.includes(toolName)
console.log(`  ${exists ? '✅' : '❌'} ${toolName} registered`)
console.log(`  ${isLocked ? '✅' : '❌'} ${toolName} NEVER_REMOVABLE`)

if (exists) {
  const result = await dispatchTool(toolName, { action: 'report' }, ctx as any)
  console.log(`  ${result.ok ? '✅' : '❌'} ${toolName} dispatch: ${result.preview.slice(0, 75)}`)
}
console.log()

// Verify all 6 enhanced agents
console.log('=== 6 Enhanced Agents Verification ===')
const enhancedAgentIds = ['trader', 'cybersecurity_a', 'cybersecurity_r', 'developer', 'testfast2', 'fasttest3']
let passCount = 0
let failCount = 0

for (const agentId of enhancedAgentIds) {
  const agent = SUBAGENTS.find(s => s.id === agentId)
  if (!agent) {
    console.log(`  ❌ ${agentId.padEnd(20)} NOT FOUND in SUBAGENTS`)
    failCount++
    continue
  }
  const hasMaxPerf = agent.systemPrompt.includes('MAX-PERFORMANCE PROTOCOL')
  const hasSpecialtyTools = agent.systemPrompt.includes('SPECIALTY TOOLS')
  const hasDomainProtocol = agent.systemPrompt.includes('DOMAIN-SPECIFIC PROTOCOL')
  const isBuiltin = agent.isBuiltin === true
  const isEnabled = agent.enabled === true
  const promptLength = agent.systemPrompt.length

  if (hasMaxPerf && hasSpecialtyTools && hasDomainProtocol && isBuiltin && isEnabled && promptLength > 1000) {
    console.log(`  ✅ ${agentId.padEnd(20)} BUILTIN, enabled, max-perf protocol (${promptLength} chars)`)
    passCount++
  } else {
    console.log(`  ❌ ${agentId.padEnd(20)} missing: ${[
      !hasMaxPerf && 'max-perf',
      !hasSpecialtyTools && 'specialty-tools',
      !hasDomainProtocol && 'domain-protocol',
      !isBuiltin && 'builtin',
      !isEnabled && 'enabled',
      promptLength <= 1000 && `prompt-too-short (${promptLength})`,
    ].filter(Boolean).join(', ')}`)
    failCount++
  }
}

console.log()
console.log('═══════════════════════════════════════════════════════════════')
console.log(`  RESULT: ${passCount}/${enhancedAgentIds.length} agents enhanced + ${exists && isLocked ? '1/1' : '0/1'} tool verified`)
console.log('═══════════════════════════════════════════════════════════════')

const totalTools = Object.keys(TOOL_REGISTRY).length
console.log()
console.log(`Total tools: ${totalTools} (expected ≥ 520)`)
console.log(`Status: ${totalTools >= 520 ? '✅ PASS' : '❌ FAIL'}`)

process.exit(failCount === 0 && exists && isLocked && totalTools >= 520 ? 0 : 1)
