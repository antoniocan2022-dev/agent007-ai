import { TOOL_REGISTRY } from '../src/lib/tools.ts'
const all = Object.keys(TOOL_REGISTRY)
console.log(`Total tools: ${all.length}`)

const requested = [
  'canva', 'grammarly', 'loom', 'mailchimp', 'convertkit',
  'buffer', 'hootsuite', 'google_analytics', 'hotjar',
  'ubersuggest', 'ahrefs', 'yoast', 'shopify', 'etsy',
  'fiverr', 'upwork'
]

console.log('\n=== REQUESTED TOOLS AUDIT ===')
for (const r of requested) {
  const matches = all.filter(t => t.toLowerCase().includes(r.toLowerCase()))
  if (matches.length > 0) {
    console.log(`  ✅ ${r}: ${matches.join(', ')}`)
  } else {
    console.log(`  ❌ ${r}: MISSING`)
  }
}

console.log('\n=== SIMILAR EXISTING TOOLS ===')
for (const kw of ['content', 'design', 'graphic', 'email_market', 'social', 'analytics', 'seo', 'ecommerce', 'freelance', 'gig']) {
  const matches = all.filter(t => t.includes(kw))
  if (matches.length > 0) {
    console.log(`  ${kw} (${matches.length}): ${matches.slice(0,5).join(', ')}${matches.length > 5 ? '...' : ''}`)
  }
}
