/**
 * Generate the TOOL_REGISTRY registration block for all 184 new tools
 * (120 subagent-enhancements + 64 phase3-optimization).
 *
 * This script reads the exported tool names from both files and generates
 * the import block + registration block that gets pasted into tools.ts.
 */
import { readFileSync, writeFileSync } from 'node:fs'

function extractTools(filePath: string, prefix: string): Array<{ exportName: string; name: string; label: string }> {
  const content = readFileSync(filePath, 'utf-8')
  const tools: Array<{ exportName: string; name: string; label: string }> = []
  // Match the full export block: export const toolXxx = createXxxTool({ ... toolName: 'yyy', toolLabel: 'zzz', ...
  // We need the EXPORT name (toolXxx), the toolName (registry key), and the toolLabel (display label).
  const blockRegex = /export\s+const\s+(tool\w+)\s*=\s*create\w+Tool\(\{[\s\S]*?toolName:\s*['"`]([^'"`]+)['"`][\s\S]*?toolLabel:\s*['"`]([^'"`]+)['"`]/g
  let match
  while ((match = blockRegex.exec(content)) !== null) {
    tools.push({ exportName: match[1], name: match[2], label: match[3] })
  }
  return tools
}

const subagentTools = extractTools('/home/z/my-project/src/lib/subagent-enhancements.ts', 'subagent')
const phase3Tools = extractTools('/home/z/my-project/src/lib/phase3-optimization.ts', 'phase3')

console.log(`Found ${subagentTools.length} subagent tools + ${phase3Tools.length} phase3 tools = ${subagentTools.length + phase3Tools.length} total`)

// Generate icon mapping (use a default icon per area)
const iconMap: Record<string, string> = {
  scout: 'search', hunt: 'crosshair', strategist: 'map', quantum: 'atom',
  legal: 'scale', banker: 'landmark', trader: 'trending-up',
  redteam: 'shield-alert', blueteam: 'shield-check', seo: 'search',
  // Phase 3
  centralized: 'brain', realtime: 'zap', context: 'network', auto: 'cpu',
  complex: 'git-branch', priority: 'alert-circle', resource: 'pie-chart',
  dependency: 'link', cross_agent: 'users', correlation: 'activity',
  bottleneck: 'alert-triangle', optimization: 'zap', agent_swarm: 'boxes',
  shared: 'share-2', conflict: 'alert-octagon', collective: 'brain',
  dynamic: 'refresh-cw', load: 'server', capacity: 'database', cost: 'dollar-sign',
  automated_quality: 'check-circle', performance: 'activity', issue: 'alert-circle',
  improvement: 'trending-up', horizontal: 'expand', load_test: 'flask-conical',
  auto_scaling: 'maximize', scalability: 'trending-up', latency: 'zap',
  throughput: 'gauge', reliability: 'shield', chaos: 'zap',
  trend: 'trending-up', behavior: 'users', performance_forecast: 'bar-chart',
  opportunity: 'target', realtime_data: 'activity', decision: 'git-commit',
  optimization_framework: 'settings', response: 'message-square',
  insight: 'lightbulb', recommendation: 'thumbs-up', knowledge: 'book-open',
  strategic: 'compass', anomaly: 'alert-circle', pattern: 'grid',
  causal: 'git-merge', prescriptive: 'clipboard-check',
  automated_model: 'cpu', ml_performance: 'activity', ml_optimization: 'cpu',
  ml_improvement: 'trending-up', continuous: 'refresh-cw',
  system_performance: 'activity', system_optimization: 'settings',
  innovation: 'lightbulb', performance_prediction: 'trending-up',
  forecasting: 'bar-chart', prediction_opt: 'target', improvement_sys: 'wrench',
  innovation_tracking: 'lightbulb', innovation_opportunities: 'target',
  innovation_frameworks: 'map', development: 'code',
}

function getIcon(toolName: string): string {
  const prefix = toolName.split('_')[0]
  return iconMap[prefix] || iconMap[toolName.split('_').slice(0, 2).join('_')] || 'zap'
}

// Generate the code block
let code = ''

// Import block for subagent-enhancements
code += '/* ================================================================== *\n'
code += ' * 120 SUB-AGENT ENHANCEMENT TOOLS — see subagent-enhancements.ts\n'
code += ' * 10 sub-agents × 3 categories × 4 tools = 120 tools\n'
code += ' * ================================================================== */\n'
code += 'import {\n'
for (const t of subagentTools) {
  code += `  ${t.exportName},\n`
}
code += `} from './subagent-enhancements'\n\n`

// Registration block for subagent-enhancements
for (const t of subagentTools) {
  const icon = getIcon(t.name)
  code += `TOOL_REGISTRY.${t.name} = { fn: ${t.exportName}, icon: '${icon}', label: ${JSON.stringify(t.label)} }\n`
}

code += '\n/* ================================================================== *\n'
code += ' * 64 PHASE 3 OPTIMIZATION TOOLS — see phase3-optimization.ts\n'
code += ' * 4 areas × 4 categories × 4 tools = 64 tools\n'
code += ' * ================================================================== */\n'
code += 'import {\n'
for (const t of phase3Tools) {
  code += `  ${t.exportName},\n`
}
code += `} from './phase3-optimization'\n\n`

for (const t of phase3Tools) {
  const icon = getIcon(t.name)
  code += `TOOL_REGISTRY.${t.name} = { fn: ${t.exportName}, icon: '${icon}', label: ${JSON.stringify(t.label)} }\n`
}

writeFileSync('/tmp/new-tool-registrations.ts', code)
console.log(`\nGenerated ${subagentTools.length + phase3Tools.length} TOOL_REGISTRY lines`)
console.log('Written to /tmp/new-tool-registrations.ts')
console.log(`File size: ${code.length} chars`)
