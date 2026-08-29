/**
 * populate-knowledge-base.ts — Upload 7 key knowledge documents to the KB.
 * UPGRADE #72 — Owner: "Populate the Knowledge Base (0 docs currently)"
 */

const KNOWLEDGE_DOCS = [
  {
    filename: 'business-strategy.md',
    mimeType: 'text/markdown',
    text: `# Agent007 Business Strategy

## Mission
Generate $20,000/month passive income with 20% monthly + 20% daily growth.

## Revenue Streams (Priority Order)
1. Affiliate Marketing (Amazon, ShareASale, ClickBank) — Target: $5,000/month
2. Digital Products (e-books, courses via Gumroad/Shopify) — Target: $7,000/month
3. Print on Demand (Etsy, Printful) — Target: $3,000/month
4. Freelance Services (Fiverr, Upwork — AI content, chatbot setup) — Target: $3,000/month
5. Content Monetization (YouTube, blog with ads) — Target: $2,000/month

## Owner Profile
- Name: Antonio Ramirez Santos
- Email: antonio.can2022@hotmail.com
- Phone: +15145496297
- Timezone: America/Toronto
- Languages: English, Spanish

## Key Metrics
- Monthly target: $20,000
- Daily growth target: 20%
- Monthly growth target: 20%
- Autonomy target: 97% (3% owner approval)
- Quality target: 97% (Grade A+)
`
  },
  {
    filename: 'affiliate-programs.md',
    mimeType: 'text/markdown',
    text: `# Active Affiliate Programs

## Amazon Associates
- Affiliate ID: tag-20 (placeholder — replace with real tag)
- Commission: 1-10% depending on category
- Cookie duration: 24 hours
- Marketplace: amazon.com (US), amazon.ca, amazon.co.uk
- Tool: affiliate_link_generator with network="amazon"

## ShareASale
- Affiliate ID: 123456 (placeholder)
- Top merchants: WP Engine, Reebok, Etsy
- Commission: 5-50% depending on merchant
- Cookie duration: 30-90 days
- Tool: affiliate_link_generator with network="shareasale"

## ClickBank
- Affiliate ID: affnick (placeholder)
- Top products: Digital courses, e-books, software
- Commission: 50-75% (highest in industry)
- Cookie duration: 60 days
- Tool: affiliate_link_generator with network="clickbank"

## Impact
- Top brands: Adidas, Airbnb, Uber
- Commission: 5-30%
- Cookie duration: 30 days
- Tool: affiliate_link_generator with network="impact"

## Awin
- Top merchants: Etsy, AliExpress, ASOS
- Commission: 3-20%
- Cookie duration: 30 days
- Tool: affiliate_link_generator with network="awwin"
`
  },
  {
    filename: 'pricing-sheets.md',
    mimeType: 'text/markdown',
    text: `# Pricing Sheets

## Digital Products
| Product | Price | Platform | Commission |
|---------|-------|----------|------------|
| AI Income Blueprint (e-book) | $27 | Gumroad | 100% |
| AI Income Course (video) | $97 | Shopify | 100% |
| ChatGPT Prompt Pack | $17 | Gumroad | 100% |
| AI Content Templates | $37 | Gumroad | 100% |
| Freelance Proposal Kit | $47 | Gumroad | 100% |

## Print on Demand
| Product | Base Cost | Sell Price | Profit |
|---------|-----------|------------|--------|
| T-shirt | $12 | $25 | $13 |
| Mug | $8 | $18 | $10 |
| Hoodie | $25 | $45 | $20 |
| Phone case | $10 | $22 | $12 |
| Poster | $15 | $30 | $15 |

## Freelance Services (Fiverr/Upwork)
| Service | Basic | Standard | Premium |
|---------|-------|----------|---------|
| AI Content Writing | $50 | $150 | $500 |
| ChatGPT Prompt Engineering | $30 | $100 | $300 |
| AI Image Generation | $25 | $75 | $200 |
| AI Chatbot Setup | $100 | $300 | $1000 |
| Data Analysis with AI | $75 | $200 | $500 |
`
  },
  {
    filename: 'niche-sops.md',
    mimeType: 'text/markdown',
    text: `# Standard Operating Procedures (SOPs)

## SOP 1: Affiliate Link Generation
1. Identify product ASIN/ID on the platform
2. Call affiliate_link_generator with network + productId + affiliateId
3. Verify the link works (test_endpoint)
4. Shorten the link if needed (bit.ly or similar)
5. Store the link in memory_store for tracking
6. Use affiliate_tracker to monitor clicks/conversions

## SOP 2: Content Creation Pipeline
1. Research trending topics (advanced_trend_analyzer)
2. Dispatch AURORA for content design
3. Write content (code_exec or manual)
4. Proofread (grammarly_check)
5. Create graphics (canva_design)
6. Create video version (loom_video)
7. Optimize for SEO (yoast_seo)
8. Publish (wordpress_publisher or shopify_store)
9. Schedule social posts (hootsuite_schedule or buffer_scheduler)
10. Track performance (google_analytics, hotjar_analytics)

## SOP 3: Course Launch
1. Research market demand (web_search, google_ai_search)
2. Design curriculum (course_creation)
3. Build landing page (website_builder)
4. Set up payment (payment_integration — Stripe)
5. Create email sequence (convertkit_email or email_automation)
6. Schedule social promotion (buffer_scheduler)
7. Monitor sales (financial_tracker)
8. Optimize based on feedback (feedback_optimization_loop)

## SOP 4: Print on Demand
1. Research trending designs (advanced_trend_analyzer)
2. Create designs (canva_design)
3. List on Etsy (etsy_integration)
4. Set up Shopify store (shopify_store)
5. Connect Printful/Printify
6. Promote via social media (buffer_scheduler)
7. Track sales (financial_tracker)
`
  },
  {
    filename: 'tool-index-quick-ref.md',
    mimeType: 'text/markdown',
    text: `# Tool Quick Reference (588+ tools)

## Most Used Tools (call these FIRST)
- smart_tool_router — find the best 10 tools for any task
- parallel_executor — run 5 tools simultaneously (3x speed)
- memory_store / memory_recall — persist + recall context
- accuracy_checker — verify facts before reporting
- decision_matrix — evaluate options against criteria

## Income Generation Tools
- affiliate_link_generator — Amazon, ShareASale, Impact, Awin, ClickBank, Generic
- stripe_payment_processor — real Stripe API (create_payment, list_payments)
- shopify_store — e-commerce setup
- etsy_integration — Etsy product listing
- fiverr_freelance — freelance service listing
- upwork_search_jobs — find Upwork jobs

## Content Creation Tools
- website_builder — landing pages, full websites
- canva_design — graphics, e-books, marketing materials
- grammarly_check — proofread content
- loom_video — video tutorials
- yoast_seo — SEO optimization

## Marketing Tools
- email_automation — send emails via Resend
- convertkit_email — email marketing automation
- buffer_scheduler — social media scheduling (API configured)
- hootsuite_schedule — multi-platform scheduling
- email_marketing_automation_full — advanced email sequences

## Analytics Tools
- google_analytics — website traffic
- hotjar_analytics — heatmaps + user feedback
- website_analytics — Plausible Analytics (configured)
- ubersuggest_seo — keyword research
- ahrefs_seo — backlink analysis

## Autonomy Tools
- task_decomposer — break complex tasks into subtasks
- result_verifier — verify outputs (6 checks)
- quality_scorer — score quality (7 dimensions, 97% target)
- smart_retry_engine — retry failed tools (3 strategies)
- autonomous_executor — full pipeline end-to-end
- progress_tracker — track multi-step progress
- parallel_subagent_dispatcher — dispatch subagents in parallel
- context_compressor — compress long conversations
`
  },
  {
    filename: 'subagent-roster.md',
    mimeType: 'text/markdown',
    text: `# Subagent Roster (20 agents, all FULL_ACCESS to 588+ tools)

## Original 12 Builtin Agents
1. AURORA — Content & Affiliate Specialist (blogs, YouTube, affiliate funnels)
2. VERTEX — SaaS & Product Developer (product ideas, MVP, launch)
3. QUANTUM — Investment Analyst (crypto, stocks, DeFi, portfolio)
4. SCOUT — Trend & Market Researcher (emerging trends, niches)
5. HUNT — Freelance & Outreach Specialist (Fiverr, Upwork, cold outreach)
6. FORGE — Code & Automation Engineer (scripts, APIs, integrations)
7. QUILL — Content Writer (articles, copy, email sequences)
8. PRISM — Design & Brand Specialist (logos, UI, brand identity)
9. PULSE — Analytics & Performance Monitor (KPIs, dashboards)
10. ECHO — Feedback & Optimization Analyst (A/B testing, refinement)
11. LEGAL — Legal & Tax Advisor (compliance, contracts, taxes)
12. BANKER — Banking & Finance Specialist (accounts, transfers, HYSA)

## 6 Promoted Builtin Agents
13. TRADER — Crypto Trading Specialist
14. Cybersecurity A — Red Team (offensive security)
15. Cybersecurity R — Blue Team (defensive security)
16. Developer — Code & Debug Specialist
17. QA Monitor (testfast2) — Internal health checks (1h/6h/12h/24h)
18. External Monitor (fasttest3) — External uptime (every 30min)

## 2 Custom Agents (from DB)
19. Content Specialist — Content creation specialist
20. Performance Analyst — Performance analysis specialist

## Passive Income Autonomy Stack (use these 4 for income tasks)
- SCOUT: Find emerging trends and niches for investment
- AURORA: Design monetization strategies for content
- PULSE: Track KPIs and performance metrics
- ECHO: Conduct A/B testing and optimization analysis
`
  },
  {
    filename: 'api-keys-status.md',
    mimeType: 'text/markdown',
    text: `# API Keys Status (configured on Vercel)

## Configured (working)
- STRIPE_SECRET_KEY ✅ — Stripe payments (real API)
- RESEND_API_KEY ✅ — Email sending (real API)
- DATABASE_URL ✅ — Postgres (prisma-postgres-agent007 store)
- BUFFER_ACCESS_TOKEN ✅ — Buffer social media scheduling
- WORDPRESS_URL + USER + APP_PASSWORD ✅ — WordPress publishing
- DATAFORSEO_EMAIL + PASSWORD ✅ — DataForSEO (keywords, backlinks)
- VERCEL_TOKEN ✅ — Vercel deploy CLI

## Not Yet Configured (set up for full autonomy)
- AMAZON_ACCESS_KEY + SECRET — Amazon affiliate API tracking
- SHAREASALE_API_TOKEN + WEB_ID — ShareASale API
- IMPACT_API_TOKEN + ACCOUNT_SID — Impact API
- AWIN_API_TOKEN + PUBLISHER_ID — Awin API
- CLICKBANK_API_KEY — ClickBank product lookup
- CONVERTKIT_API_KEY + SECRET — ConvertKit email automation
- HOOTSUITE_ACCESS_TOKEN — Hootsuite scheduling
- GA4_MEASUREMENT_ID + PROPERTY_ID — Google Analytics 4
- HOTJAR_SITE_ID — Hotjar heatmaps
- UBERSUGGEST_API_KEY — Ubersuggest keyword research
- AHREFS_API_KEY — Ahrefs SEO analysis
- SHOPIFY_API_KEY + SECRET + STORE_URL — Shopify store
- UPSTASH_REDIS_URL + TOKEN — Redis caching
- KRAKEN_API_KEY + SECRET — Kraken crypto trading (private)
- PAYPAL_CLIENT_ID + SECRET — PayPal REST API

## Deployment Governance
Production deployment is controlled exclusively by the governed GitHub Actions release workflow. Direct deployment commands are intentionally not documented here.
`
  }
]

async function main() {
  console.log(`Populating knowledge base with ${KNOWLEDGE_DOCS.length} documents...`)
  const { db } = await import('../src/lib/db')
  const { indexDocument } = await import('../src/lib/knowledge-base')
  
  const userId = (await db.user.findFirst({ orderBy: { createdAt: 'asc' } }))?.id
  if (!userId) {
    console.error('No operator user found')
    process.exit(1)
  }
  
  let created = 0
  for (const doc of KNOWLEDGE_DOCS) {
    try {
      // Check if doc already exists
      const existing = await db.knowledgeDoc.findFirst({ where: { filename: doc.filename, userId } })
      if (existing) {
        console.log(`  ⏭️  ${doc.filename} already exists (${existing.chunkCount} chunks) — skipping`)
        continue
      }
      
      const result = await indexDocument({
        userId,
        filename: doc.filename,
        mimeType: doc.mimeType,
        size: doc.text.length,
        text: doc.text,
      })
      
      if (result.ok) {
        console.log(`  ✅ ${doc.filename}: ${result.chunkCount} chunks indexed`)
        created++
      } else {
        console.log(`  ❌ ${doc.filename}: ${result.error}`)
      }
    } catch (e: any) {
      console.log(`  ❌ ${doc.filename}: ${e?.message}`)
    }
  }
  
  console.log(`\nDone: ${created} new documents indexed`)
  console.log(`Total KB docs: ${await db.knowledgeDoc.count()}`)
}

main().catch(e => { console.error('FATAL:', e); process.exit(1) })
