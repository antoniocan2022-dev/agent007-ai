import { toolCanvaDesign, toolGrammarlyCheck, toolLoomVideo, toolConvertKitEmail, toolHootsuiteSchedule, toolGoogleAnalytics, toolHotjarAnalytics, toolUbersuggestSEO, toolAhrefsSEO, toolYoastSEO, toolShopifyStore, toolFiverrFreelance } from '../src/lib/external-platform-tools'

async function test() {
  console.log('Testing 12 external platform tools...\n')
  const tools = [
    ['canva_design', () => toolCanvaDesign({ type: 'social_post', title: 'My Product' })],
    ['grammarly_check', () => toolGrammarlyCheck({ text: 'i think this is alot of fun. their is no problem here.' })],
    ['loom_video', () => toolLoomVideo({ title: 'How to use Agent007', type: 'tutorial' })],
    ['convertkit_email', () => toolConvertKitEmail({ action: 'list_forms' })],
    ['hootsuite_schedule', () => toolHootsuiteSchedule({ action: 'schedule', message: 'Check out Agent007!', platforms: ['twitter', 'facebook'] })],
    ['google_analytics', () => toolGoogleAnalytics({ action: 'overview', metric: 'sessions' })],
    ['hotjar_analytics', () => toolHotjarAnalytics({ action: 'heatmap', url: 'https://example.com' })],
    ['ubersuggest_seo', () => toolUbersuggestSEO({ action: 'keyword_research', keyword: 'passive income' })],
    ['ahrefs_seo', () => toolAhrefsSEO({ action: 'site_audit', domain: 'example.com' })],
    ['yoast_seo', () => toolYoastSEO({ action: 'analyze', content: 'This is a blog post about passive income. It has multiple paragraphs.\n\n## Introduction\n\nPassive income is great.\n\n![Image](https://example.com/img.png)', focus_keyword: 'passive income', title: 'Passive Income Guide' })],
    ['shopify_store', () => toolShopifyStore({ action: 'setup', store_name: 'my-store' })],
    ['fiverr_freelance', () => toolFiverrFreelance({ action: 'search_gigs', service: 'AI content writing' })],
  ]
  for (const [name, fn] of tools) {
    const r = await fn()
    console.log(`${r.ok ? '✅' : '❌'} ${name}: ${r.preview?.slice(0, 80)}`)
  }
  console.log('\nAll 12 tools tested ✅')
}
test().catch(console.error)
