import { TOOL_REGISTRY } from '../src/lib/tools.ts'

const all = Object.keys(TOOL_REGISTRY)
console.log(`Total tools: ${all.length}`)
console.log('')
console.log('=== AFFILIATE-RELATED TOOLS ===')
const affiliateTools = all.filter((t) => t.includes('affiliate') || t.includes('partner') || t.includes('commission') || t.includes('referral'))
console.log(`Found ${affiliateTools.length} affiliate-related tools:`)
for (const t of affiliateTools) {
  const entry = (TOOL_REGISTRY as any)[t]
  console.log(`  - ${t}: ${entry?.label ?? '(no label)'}`)
}
console.log('')
console.log('=== LINK-RELATED TOOLS ===')
const linkTools = all.filter((t) => t.includes('link') || t.includes('url') || t.includes('shorten'))
console.log(`Found ${linkTools.length} link-related tools:`)
for (const t of linkTools.slice(0, 15)) {
  const entry = (TOOL_REGISTRY as any)[t]
  console.log(`  - ${t}: ${entry?.label ?? '(no label)'}`)
}
