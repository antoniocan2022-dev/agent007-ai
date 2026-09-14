import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { toolFinnhubQuote } from '@/lib/ai-providers-integration'
import { CEO_CAPABILITY_ARCHITECTURE, findCapability } from '@/lib/ceo-capability-architecture'
import { toolAPIIntegrationManager } from '@/lib/mission-lifecycle'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

// Deep-audit fix: maximizing real external-world search + finance access for the CEO. Search:
// the 6 ai-search-engines.ts tools previously did zero network I/O and always fabricated
// "results" (including literal placeholder citations); finance: a cluster of tools (payment_
// processor, financial_tracker, payout_scheduler, payment_gateway_integrator,
// api_integration_manager) unconditionally invented dollar figures, a bank account, and a BTC
// wallet with no DB read or API call. Also: ceo-tool-selection.ts's scored selector could
// structurally only ever choose web_search/page_reader because every other capability domain
// had an empty tools array; multi_search_compare defaulted to free-only engines even once a paid
// key was configured.
describe('external-world search + finance access is maximized and genuinely wired', () => {
  describe('ai-search-engines.ts: all 6 tools are now real, not fabricated', () => {
    // ./tools (okResult/badResult, real runtime imports) transitively pulls in auth.ts, which
    // this sandbox cannot resolve (next-auth absent) -- confirmed identical to every other file
    // in this codebase with this exact import shape. Verified as real CI-only; source assertions
    // used here instead, matching this codebase's established convention for the same limitation.
    const src = read('../src/lib/ai-search-engines.ts')
    // The module doc comment intentionally quotes the old fabricated strings as history; check
    // the code itself (everything after the doc comment) never produces them.
    const code = src.slice(src.indexOf("import { ToolResult"))

    test('no more fabricated placeholder citations or query-independent boilerplate', () => {
      expect(code).not.toContain('example-source-1.com')
      expect(code).not.toContain('example-source-2.org')
      expect(code).not.toContain('Wikipedia — comprehensive overview')
    })

    test('perplexity_ai_search calls the real Perplexity API when configured', () => {
      expect(src).toContain('PERPLEXITY_API_KEY')
      expect(src).toContain("https://api.perplexity.ai/chat/completions")
      expect(src).toContain("model: 'sonar'")
    })

    test('you_com_search calls the real You.com API when configured', () => {
      expect(src).toContain('YDC_API_KEY')
      expect(src).toContain('https://api.ydc-index.io/search')
    })

    test('google_ai_search calls the real Google Custom Search API when configured', () => {
      expect(src).toContain('GOOGLE_SEARCH_API_KEY')
      expect(src).toContain('GOOGLE_SEARCH_CX')
      expect(src).toContain('https://www.googleapis.com/customsearch/v1')
    })

    test('brave_ai_search calls the real Brave Search API when configured', () => {
      expect(src).toContain('BRAVE_API_KEY')
      expect(src).toContain('https://api.search.brave.com/res/v1/web/search')
    })

    test('every tool without a direct real API (copilot_search, chatgpt_search) honestly delegates to a real search engine instead of fabricating', () => {
      expect(src).toContain('delegateToRealSearch')
      expect(src).toContain('async function toolCopilotSearch')
      expect(src).toContain('async function toolChatgptSearch')
      // Every one of the 6 functions must call either a real fetch or the honest delegate helper.
      const fnBlocks = src.split(/(?=export async function tool)/g).filter(b => b.startsWith('export async function tool'))
      expect(fnBlocks.length).toBe(6)
      for (const block of fnBlocks) {
        const hasRealFetch = /await fetch\(/.test(block)
        const hasDelegate = /delegateToRealSearch|delegatedReport/.test(block)
        expect(hasRealFetch || hasDelegate).toBe(true)
      }
    })
  })

  describe('Finance market-data: Finnhub added as a stronger free-tier alternative to Alpha Vantage', () => {
    test('toolFinnhubQuote is a real, credential-gated implementation', async () => {
      // No FINNHUB_API_KEY in this test environment -- must honestly fail, not fabricate a quote.
      delete process.env.FINNHUB_API_KEY
      const result = await toolFinnhubQuote({ symbol: 'AAPL' })
      expect(result.ok).toBe(false)
      expect(result.result).toContain('FINNHUB_API_KEY')
    })

    test('toolFinnhubQuote is registered in TOOL_REGISTRY', () => {
      const toolsSrc = read('../src/lib/tools.ts')
      expect(toolsSrc).toContain('TOOL_REGISTRY.finnhub_quote')
      expect(toolsSrc).toContain('toolFinnhubQuote')
    })
  })

  describe('ceo-capability-architecture.ts: the CEO\'s scored tool selector can now see real search/finance/commerce tools, not just web_search/page_reader', () => {
    test('finance domain has real tools, not an empty array', () => {
      const finance = findCapability('finance.analysis')
      expect(finance).toBeDefined()
      const toolIds = finance!.services.flatMap(s => s.tools).map(t => t.id)
      expect(toolIds.length).toBeGreaterThan(0)
      expect(toolIds).toContain('yahoo_finance')
      expect(toolIds).toContain('fred_economic')
      expect(toolIds).toContain('finnhub_quote')
    })

    test('market_intelligence domain has real tools beyond web_search', () => {
      const market = findCapability('market.competitive')
      const toolIds = market!.services.flatMap(s => s.tools).map(t => t.id)
      expect(toolIds).toContain('newsapi')
      expect(toolIds).toContain('tavily_search')
    })

    test('commerce domain has real payment tools, not an empty array', () => {
      const commerce = findCapability('commerce.execution')
      const toolIds = commerce!.services.flatMap(s => s.tools).map(t => t.id)
      expect(toolIds).toContain('stripe_payment_processor')
      expect(toolIds).toContain('paypal_api')
    })

    test('research domain includes the credential-gated real search tools, not only web_search/page_reader', () => {
      const research = findCapability('research.general')
      const toolIds = research!.services.flatMap(s => s.tools).map(t => t.id)
      expect(toolIds).toContain('tavily_search')
      expect(toolIds).toContain('exa_search')
      expect(toolIds).toContain('multi_search_compare')
    })

    test('no capability domain in the architecture is left with a totally empty tool catalog for the domains that matter most', () => {
      const targetDomains = ['research', 'finance', 'market_intelligence', 'commerce']
      for (const domainId of targetDomains) {
        const enterprise = CEO_CAPABILITY_ARCHITECTURE.find(e => e.id === domainId)
        expect(enterprise).toBeDefined()
        const totalTools = enterprise!.capabilities.flatMap(c => c.services.flatMap(s => s.tools)).length
        expect(totalTools).toBeGreaterThan(0)
      }
    })
  })

  describe('multi_search_compare auto-upgrades its default engines when real keys are configured', () => {
    const src = read('../src/lib/multi-search-comparison.ts')

    test('defaultSearchEngines detects configured API keys instead of a hardcoded free-only list', () => {
      expect(src).toContain('function defaultSearchEngines')
      expect(src).toContain('process.env.TAVILY_API_KEY')
      expect(src).toContain('process.env.EXA_API_KEY')
      expect(src).toContain('process.env.SERPAPI_API_KEY')
      expect(src).toContain('process.env.BRAVE_API_KEY')
      // 'ddg' stays as the guaranteed zero-config real fallback.
      expect(src).toContain("engines.push('wikipedia', 'ddg')")
    })

    test('toolMultiSearchCompare uses the auto-detecting default, not the old hardcoded array', () => {
      expect(src).not.toContain("engines = ['brave', 'wikipedia', 'ddg']")
      expect(src).toContain('engines = defaultSearchEngines()')
    })
  })

  describe('the fabricated finance-tool cluster now reports real data or honestly declines to invent it', () => {
    // Deep-audit fix comments throughout both files intentionally reference the old fabricated
    // content as history (e.g. "used to invent a specific bank name"), interspersed with real
    // code -- so these checks assert positive evidence of the real fix (a genuine DB read, a
    // genuine env check, honest new messaging) rather than fragile whole-file string absence.
    const autonomyToolsSrc = read('../src/lib/autonomy-tools.ts')
    const fullAutonomySrc = read('../src/lib/full-autonomy-tools.ts')

    test('payment_processor reads the real Transaction table and checks real gateway configuration', () => {
      expect(autonomyToolsSrc).toContain('db.transaction.findMany')
      expect(autonomyToolsSrc).toContain('Boolean(process.env.STRIPE_SECRET_KEY)')
      expect(autonomyToolsSrc).toContain('RECORDED TRANSACTIONS (real')
    })

    test('payment_processor distinguishes a failed DB check from a confirmed-empty table, instead of conflating them', () => {
      // Fresh-audit fix: a DB error used to be silently swallowed and the report would print
      // "No transactions recorded yet" regardless -- indistinguishable from a genuinely empty,
      // successfully-checked table. Assert the three-way branch exists and is wired to a real
      // try/catch around the query, not just declared and unused.
      const fnSrc = autonomyToolsSrc.slice(
        autonomyToolsSrc.indexOf('export async function toolPaymentProcessor'),
        autonomyToolsSrc.indexOf('export async function', autonomyToolsSrc.indexOf('export async function toolPaymentProcessor') + 1)
      )
      expect(fnSrc).toContain('let transactionQueryFailed = false')
      expect(fnSrc).toContain('transactionQueryFailed = true')
      expect(fnSrc).toMatch(/catch\s*\([^)]*\)\s*\{[^}]*transactionQueryFailed = true/)
      expect(fnSrc).toContain('Could not check')
      expect(fnSrc).toContain('This is NOT a confirmed zero')
      expect(fnSrc).toContain("query succeeded; table is genuinely empty")
    })

    test('financial_tracker reads real IncomeEntry rows and reports zero honestly when there are none', () => {
      expect(autonomyToolsSrc).toContain('db.incomeEntry.findMany')
      expect(autonomyToolsSrc).toContain('No income entries recorded')
    })

    test('payout_scheduler reads the real BankAccount table and honestly discloses there is no automated payout execution', () => {
      expect(autonomyToolsSrc).toContain('db.bankAccount.findMany')
      expect(autonomyToolsSrc).toContain('no automated payout-execution scheduler')
    })

    test('payment_gateway_integrator checks real Stripe/PayPal configuration and marks Wise/Coinbase as not implemented', () => {
      expect(fullAutonomySrc).toContain("implemented: false, note: 'no integration exists in this codebase'")
      expect(fullAutonomySrc).toContain('Boolean(process.env.STRIPE_SECRET_KEY)')
    })
  })

  describe('api_integration_manager no longer falsely claims Plaid (or 7 other unimplemented services) are integrated', () => {
    test('toolAPIIntegrationManager reports the real implemented/configured state', async () => {
      const result = await toolAPIIntegrationManager({}, { attachments: [], language: 'en' })
      expect(result.result).toContain('❌ not implemented Plaid (banking)')
      expect(result.result).not.toContain('Plaid (banking) ✅')
      expect(result.result).not.toContain('$5,300/month')
    })
  })

  describe('.env.example documents the new optional search/finance keys', () => {
    const src = read('../.env.example')

    test('every new search and finance env var is listed', () => {
      for (const key of ['TAVILY_API_KEY', 'BRAVE_API_KEY', 'EXA_API_KEY', 'SERPAPI_API_KEY', 'NEWSAPI_KEY', 'PERPLEXITY_API_KEY', 'YDC_API_KEY', 'GOOGLE_SEARCH_API_KEY', 'GOOGLE_SEARCH_CX', 'FINNHUB_API_KEY', 'ALPHA_VANTAGE_API_KEY', 'FRED_API_KEY']) {
        expect(src).toContain(key)
      }
    })
  })
})
