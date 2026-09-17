import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { toolExaSearch, toolFinnhubQuote, toolSerpAPI, toolTavilySearch } from '@/lib/ai-providers-integration'
import { CEO_CAPABILITY_ARCHITECTURE, findCapability, findCapabilityForDomain } from '@/lib/ceo-capability-architecture'
import type { CeoExecutionContract } from '@/lib/ceo-cognitive-contract'
import { selectCeoTool } from '@/lib/ceo-tool-selection'
import { toolAPIIntegrationManager } from '@/lib/mission-lifecycle'
import { toolHealthChecker, toolSelfHealingTools } from '@/lib/tool-testing-coordination'
import { buildExternalEvidencePlan } from '@/lib/ceo-evidence-planner'
import { sourceTierForUrl } from '@/lib/ceo-evidence-bundle'
import { getToolDiscoveryPrompt } from '@/lib/provider-intelligence'
import { toolRoicStockPrices, toolRoicFinancials, toolTiingoDaily, toolPolygonAggregates, toolPolygonCorporateActions } from '@/lib/ai-providers-integration'
import { toolFirecrawlScrape, toolFirecrawlMap, toolFirecrawlCrawl, toolSpiderScrape, toolSpiderCrawl, pollFirecrawlJob } from '@/lib/site-crawl-tools'
import { coOccurringEntityPairs, toolEvidenceGraphQuery } from '@/lib/ceo-evidence-graph'
import { buildTimeline, toolEvidenceTimeline } from '@/lib/ceo-evidence-timeline'
import { watchThresholdBreached, toolCreateEvidenceWatch, toolListEvidenceWatches } from '@/lib/ceo-evidence-watch'

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

// Fresh-audit fix (round 2): an independent adversarial re-audit of this same PR found two genuinely
// new REAL BUGs the prior review's registry/Prisma/test-suite checks couldn't have caught, because
// both are integration bugs between this PR's files and pre-existing consumers this PR never touched
// (ceo-tool-selection.ts, ceo-evidence-executor.ts) -- invisible to any test that only exercises the
// changed files in isolation, as this suite's earlier tests all do.
describe('fresh-audit round 2: capability-domain reachability and evidence-pipeline URL parsing', () => {
  describe('Finding A: finance/commerce capability domains are now actually reachable through selectCeoTool(), not silently falling back to web_search', () => {
    // The bug: selectCeoTool used to guess a capability's id from its domain via two hardcoded
    // suffix patterns (".competitive" for market_intelligence, ".general" for research) that only
    // matched those two domains by coincidence -- finance's real id is "finance.analysis",
    // commerce's is "commerce.execution", neither matches either guessed suffix, so the lookup
    // silently returned zero candidates and every finance/commerce contract fell back to web_search
    // via ceo-evidence-executor.ts's `plan.selectedTool ?? 'web_search'`, no matter how many real
    // tools this file's own tools arrays listed for those domains.
    test('findCapabilityForDomain looks up every populated domain by its real id, not a guessed suffix', () => {
      for (const domain of ['research', 'finance', 'market_intelligence', 'commerce'] as const) {
        const descriptor = findCapabilityForDomain(domain)
        expect(descriptor).toBeDefined()
        const toolIds = descriptor!.services.flatMap((s) => s.tools).map((t) => t.id)
        expect(toolIds.length).toBeGreaterThan(0)
      }
      const finance = findCapabilityForDomain('finance')
      expect(finance!.id).toBe('finance.analysis')
      const commerce = findCapabilityForDomain('commerce')
      expect(commerce!.id).toBe('commerce.execution')
      expect(commerce!.services.flatMap((s) => s.tools).map((t) => t.id)).toEqual(expect.arrayContaining(['stripe_payment_processor', 'paypal_api']))
    })

    test('selectCeoTool actually picks a real finance tool for an internal_finance contract, not web_search', () => {
      const contract: CeoExecutionContract = {
        intent: 'decision', evidenceClass: 'external_web', domain: 'internal_finance', operation: 'decide',
        temporalScope: 'current', evidenceProfile: 'general_research', evidenceRequirement: 'external_web',
        executionRequirement: 'one_tool', orchestrationOwner: 'ceo_lifecycle', maxTurns: 1, maxRecoveries: 0,
        latencyBudgetMs: 10000, toolRequired: true, subagentsRequired: false, reason: 'test: finance evidence need',
      }
      const selection = selectCeoTool(contract)
      // internal_finance -> capabilityForDomain -> 'finance' capability, which has no web_search entry at all --
      // before the fix, candidates was always [] and selected was always undefined here.
      expect(selection.candidates.length).toBeGreaterThan(0)
      expect(selection.selected).toBeDefined()
      const financeToolIds = ['yahoo_finance', 'coingecko', 'finnhub_quote', 'alpha_vantage', 'fred_economic', 'financial_tracker', 'payment_processor']
      expect(financeToolIds).toContain(selection.selected!.id)
    })
  })

  describe('Finding B: newly-wired research search tools now emit output the evidence pipeline\'s "URL: <link>" extractor can actually parse', () => {
    // The bug: ceo-evidence-executor.ts's urlsFromSearchResult only recognizes lines matching
    // /URL:\s*(https?:\/\/[^\s]+)/gi (the format web_search itself has always used). tavily_search/
    // serpapi/exa_search used to dump raw JSON.stringify(data) with no such label; perplexity/google/
    // you.com/brave printed bare links with no "URL:" prefix either. A genuinely successful call to
    // any of them contributed zero evidence sources, silently -- recorded as status 'partial' even
    // though the API call itself succeeded, poisoning the observed-reliability feedback loop.
    const urlLabelRe = /URL:\s*(https?:\/\/[^\s]+)/i

    test('tavily_search formats real results with "URL:" labels the evidence extractor recognizes', async () => {
      const originalFetch = globalThis.fetch
      process.env.TAVILY_API_KEY = 'test-tavily-key'
      globalThis.fetch = (async () => new Response(JSON.stringify({
        results: [{ title: 'Example Result', url: 'https://example.com/article', content: 'Some real content snippet.' }],
      }), { status: 200 })) as typeof fetch
      try {
        const result = await toolTavilySearch({ query: 'test query' })
        expect(result.ok).toBe(true)
        expect(result.result).toMatch(urlLabelRe)
        expect(urlLabelRe.exec(result.result)?.[1]).toBe('https://example.com/article')
      } finally {
        globalThis.fetch = originalFetch
        delete process.env.TAVILY_API_KEY
      }
    })

    test('serpapi formats real organic_results with "URL:" labels the evidence extractor recognizes', async () => {
      const originalFetch = globalThis.fetch
      process.env.SERPAPI_API_KEY = 'test-serpapi-key'
      globalThis.fetch = (async () => new Response(JSON.stringify({
        organic_results: [{ title: 'Example Result', link: 'https://example.org/page', snippet: 'A snippet.' }],
      }), { status: 200 })) as typeof fetch
      try {
        const result = await toolSerpAPI({ query: 'test query' })
        expect(result.ok).toBe(true)
        expect(result.result).toMatch(urlLabelRe)
        expect(urlLabelRe.exec(result.result)?.[1]).toBe('https://example.org/page')
      } finally {
        globalThis.fetch = originalFetch
        delete process.env.SERPAPI_API_KEY
      }
    })

    test('exa_search formats real results with "URL:" labels the evidence extractor recognizes', async () => {
      const originalFetch = globalThis.fetch
      process.env.EXA_API_KEY = 'test-exa-key'
      globalThis.fetch = (async () => new Response(JSON.stringify({
        results: [{ title: 'Example Result', url: 'https://example.net/doc', text: 'Some text.' }],
      }), { status: 200 })) as typeof fetch
      try {
        const result = await toolExaSearch({ query: 'test query' })
        expect(result.ok).toBe(true)
        expect(result.result).toMatch(urlLabelRe)
        expect(urlLabelRe.exec(result.result)?.[1]).toBe('https://example.net/doc')
      } finally {
        globalThis.fetch = originalFetch
        delete process.env.EXA_API_KEY
      }
    })

    test('a provider response with no parseable results falls back to the raw payload instead of losing data', async () => {
      const originalFetch = globalThis.fetch
      process.env.TAVILY_API_KEY = 'test-tavily-key'
      globalThis.fetch = (async () => new Response(JSON.stringify({ results: [] }), { status: 200 })) as typeof fetch
      try {
        const result = await toolTavilySearch({ query: 'test query with zero results 98765' })
        expect(result.ok).toBe(true)
        expect(result.result).toContain('"results":[]')
      } finally {
        globalThis.fetch = originalFetch
        delete process.env.TAVILY_API_KEY
      }
    })

    test('ai-search-engines.ts: google/you.com/brave/perplexity real-API branches all label result links "URL:"', () => {
      const src = read('../src/lib/ai-search-engines.ts')
      // Google: item.link
      expect(src).toContain('URL: ${item.link}')
      // You.com: h.url
      expect(src).toContain('URL: ${h.url}')
      // Brave: r.url
      expect(src).toContain('URL: ${r.url}')
      // Perplexity citations
      expect(src).toContain('URL: ${c}')
    })
  })

  describe('Angle 1: delegateToRealSearch no longer stacks unbounded sequential timeouts', () => {
    const src = read('../src/lib/ai-search-engines.ts')

    test('delegateToRealSearch races each attempt against a shared overall deadline', () => {
      expect(src).toContain('overallTimeoutMs = 20000')
      expect(src).toContain('Promise.race([')
      expect(src).toContain('const deadline = Date.now() + overallTimeoutMs')
    })

    test('brave_ai_search no longer stacks a redundant ddg_search attempt ahead of web_search\'s own internal DuckDuckGo fallback', () => {
      expect(src).not.toContain("delegateToRealSearch(query, ['tavily_search', 'serpapi', 'ddg_search', 'web_search'])")
    })
  })

  describe('Angle 3: tavily_search/serpapi now dedupe repeat queries within a short TTL instead of always re-hitting the real API', () => {
    test('a second identical query is served from cache, not a second real fetch', async () => {
      const originalFetch = globalThis.fetch
      process.env.TAVILY_API_KEY = 'test-tavily-key'
      let fetchCount = 0
      globalThis.fetch = (async () => {
        fetchCount += 1
        return new Response(JSON.stringify({ results: [{ title: 'X', url: 'https://example.com/x', content: 'x' }] }), { status: 200 })
      }) as typeof fetch
      try {
        const first = await toolTavilySearch({ query: 'cache test query unique 12345' })
        const second = await toolTavilySearch({ query: 'cache test query unique 12345' })
        expect(first.ok).toBe(true)
        expect(second.ok).toBe(true)
        expect(fetchCount).toBe(1)
      } finally {
        globalThis.fetch = originalFetch
        delete process.env.TAVILY_API_KEY
      }
    })
  })

  describe('Angle 7: configured-but-failing credentials now fall back to the honest delegate instead of hard-failing', () => {
    const src = read('../src/lib/ai-search-engines.ts')

    test('google/perplexity/you.com/brave all delegate on a runtime failure, not only when unconfigured', () => {
      for (const marker of ['GOOGLE_SEARCH_API_KEY is configured but the live call failed', 'PERPLEXITY_API_KEY is configured but the live call failed', 'YDC_API_KEY is configured but the live call failed', 'BRAVE_API_KEY is configured but the live call failed']) {
        expect(src).toContain(marker)
      }
    })

    test('the dead needKey() helper was removed (every tool used inline badResult calls instead)', () => {
      expect(src).not.toContain('function needKey(tool: string, envVar: string, url: string)')
    })
  })

  describe('Follow-on fix: making finance/commerce domains reachable (Finding A) exposed a latent argument-shape mismatch, now guarded against', () => {
    // executeSearch in ceo-evidence-executor.ts always dispatches the selected tool with a free-text
    // {query, num, recency_days} argument shape. Before Finding A's fix, finance/commerce domains were
    // structurally unreachable, so this mismatch never manifested. Now that selectCeoTool can genuinely
    // pick finnhub_quote/alpha_vantage/fred_economic/financial_tracker/payment_processor/etc. for a
    // finance-domain evidence request, dispatching any of them with {query,...} would deterministically
    // fail (they need "symbol"/"series_id" or no query at all) -- a real regression versus the
    // previously-working web_search fallback. Confirm the executor only ever hands a genuine
    // free-text search tool to executeSearch.
    const src = read('../src/lib/ceo-evidence-executor.ts')

    test('executeOnce only trusts plan.selectedTool when it is a genuine free-text search tool', () => {
      expect(src).toContain('QUERY_SEARCH_TOOL_IDS')
      expect(src).toContain("plan.selectedTool && QUERY_SEARCH_TOOL_IDS.has(plan.selectedTool) ? plan.selectedTool : 'web_search'")
    })

    test('the allowlist excludes the newly-reachable non-search finance/commerce tools', () => {
      const setLine = src.slice(src.indexOf('const QUERY_SEARCH_TOOL_IDS'), src.indexOf(')', src.indexOf('const QUERY_SEARCH_TOOL_IDS')))
      for (const nonSearchTool of ['finnhub_quote', 'alpha_vantage', 'fred_economic', 'yahoo_finance', 'coingecko', 'financial_tracker', 'payment_processor', 'stripe_payment_processor', 'paypal_api', 'page_reader', 'jina_reader']) {
        expect(setLine).not.toContain(`'${nonSearchTool}'`)
      }
    })

    test('the allowlist includes every genuine free-text search tool the research/market_intelligence domains list', () => {
      const setLine = src.slice(src.indexOf('const QUERY_SEARCH_TOOL_IDS'), src.indexOf(')', src.indexOf('const QUERY_SEARCH_TOOL_IDS')))
      for (const searchTool of ['web_search', 'tavily_search', 'exa_search', 'serpapi', 'perplexity_ai_search', 'newsapi', 'multi_search_compare', 'kb_search']) {
        expect(setLine).toContain(`'${searchTool}'`)
      }
    })
  })

  describe('pre-existing env-var-name bug found while checking for collisions: security-self-healing.ts now checks the names the real tool readers actually use', () => {
    test('the API-key self-check list uses ALPHA_VANTAGE_API_KEY, NEWSAPI_KEY, CLOUDFLARE_API_KEY, REMOVE_BG_API_KEY', () => {
      const src = read('../src/lib/security-self-healing.ts')
      expect(src).toContain("'ALPHA_VANTAGE_API_KEY'")
      expect(src).toContain("'NEWSAPI_KEY'")
      expect(src).toContain("'CLOUDFLARE_API_KEY'")
      expect(src).toContain("'REMOVE_BG_API_KEY'")
      // The apiKeys array itself (not just the explanatory comment) must not contain the old wrong names.
      const arraySrc = src.slice(src.indexOf('const apiKeys = ['), src.indexOf(']', src.indexOf('const apiKeys = [')))
      expect(arraySrc).not.toContain('ALPHAVANTAGE_API_KEY')
      expect(arraySrc).not.toContain("'NEWSAPI_API_KEY'")
      expect(arraySrc).not.toContain('CLOUDFLARE_API_TOKEN')
      expect(arraySrc).not.toContain('REMOVEBG_API_KEY')
    })
  })
})

// User-requested round: (1) the three self-check var-name bugs flagged in the live API-key audit
// (Google Analytics, Hootsuite, Product Hunt) fixed everywhere they appear, plus the same class of
// bug found while fixing them (Alpha Vantage, and 5 more tools whose "requires this key" map
// pointed at a name the real tool never reads); (2) etsy_integration rebuilt to make a real Etsy
// API call using ETSY_API_KEY instead of returning hardcoded fabricated sales data.
describe('user-requested round: self-check env-var-name bugs fixed, Etsy tool rebuilt for real', () => {
  describe('capability-audit/route.ts: the 3 flagged bugs + the same-class Alpha Vantage bug', () => {
    const src = readFileSync(new URL('../src/app/api/system/capability-audit/route.ts', import.meta.url), 'utf8')

    test('hootsuite_schedule now checks BUFFER_ACCESS_TOKEN (what the tool actually redirects to)', () => {
      expect(src).toContain("hootsuite_schedule: ['BUFFER_ACCESS_TOKEN']")
    })

    test('google_analytics now checks GA4_API_KEY + GA4_PROPERTY_ID (what the real tool actually reads)', () => {
      expect(src).toContain("google_analytics: ['GA4_API_KEY', 'GA4_PROPERTY_ID']")
      expect(src).toContain("!isEnvSet('GA4_API_KEY') || !isEnvSet('GA4_PROPERTY_ID')")
      expect(src).not.toContain("GOOGLE_ANALYTICS_API_KEY'")
    })

    test('alpha_vantage now checks ALPHA_VANTAGE_API_KEY (with the underscore the real tool reads)', () => {
      expect(src).toContain("alpha_vantage: ['ALPHA_VANTAGE_API_KEY']")
    })
  })

  describe('tool-testing-coordination.ts: the wrong-name map corrected wholesale, and Product Hunt specifically', () => {
    test('TOOLS_REQUIRING_KEYS no longer contains any of the confirmed-wrong names', () => {
      const src = readFileSync(new URL('../src/lib/tool-testing-coordination.ts', import.meta.url), 'utf8')
      const mapSrc = src.slice(src.indexOf('const TOOLS_REQUIRING_KEYS'), src.indexOf('const REAL_EXECUTABLE_TOOLS'))
      for (const wrongName of ['PRODUCTHUNT_API_TOKEN', 'HOOTSUITE_ACCESS_TOKEN', 'GOOGLE_ANALYTICS_API_KEY', 'ALPHAVANTAGE_API_KEY', 'CLOUDFLARE_API_TOKEN', 'NEWSAPI_API_KEY', 'REMOVEBG_API_KEY', 'RAPIDAPI_KEY', 'WP_APP_PASSWORD', 'HOTJAR_API_KEY', 'UBERSUGGEST_API_KEY', 'AHREFS_API_KEY']) {
        expect(mapSrc).not.toContain(`'${wrongName}'`)
      }
      expect(mapSrc).toContain("product_hunt: ['PRODUCTHUNT_API_KEY']")
    })

    test('toolHealthChecker’s missing_keys report reflects the corrected names (live)', async () => {
      const originalProductHuntKey = process.env.PRODUCTHUNT_API_KEY
      const originalHootsuiteKey = process.env.HOOTSUITE_ACCESS_TOKEN
      delete process.env.PRODUCTHUNT_API_KEY
      process.env.HOOTSUITE_ACCESS_TOKEN = 'phantom-value-that-should-not-matter'
      delete process.env.BUFFER_ACCESS_TOKEN
      try {
        const result = await toolHealthChecker({ action: 'missing_keys' })
        expect(result.ok).toBe(true)
        expect(result.result).toContain('product_hunt → PRODUCTHUNT_API_KEY')
        // Hootsuite must show as missing via BUFFER_ACCESS_TOKEN, not as configured just because
        // the old (now-unused) HOOTSUITE_ACCESS_TOKEN happens to be set.
        expect(result.result).toContain('hootsuite_schedule → BUFFER_ACCESS_TOKEN')
      } finally {
        if (originalProductHuntKey === undefined) delete process.env.PRODUCTHUNT_API_KEY; else process.env.PRODUCTHUNT_API_KEY = originalProductHuntKey
        if (originalHootsuiteKey === undefined) delete process.env.HOOTSUITE_ACCESS_TOKEN; else process.env.HOOTSUITE_ACCESS_TOKEN = originalHootsuiteKey
      }
    })

    test('toolSelfHealingTools diagnose treats a multi-var requirement (Google Analytics) as satisfied only when every var is set', async () => {
      const originalGa4Key = process.env.GA4_API_KEY
      const originalGa4Prop = process.env.GA4_PROPERTY_ID
      process.env.GA4_API_KEY = 'test-key'
      delete process.env.GA4_PROPERTY_ID
      try {
        const result = await toolSelfHealingTools({ action: 'diagnose' })
        expect(result.result).toContain('google_analytics → GA4_API_KEY + GA4_PROPERTY_ID')
        process.env.GA4_PROPERTY_ID = 'test-property'
        const result2 = await toolSelfHealingTools({ action: 'diagnose' })
        expect(result2.result).not.toContain('google_analytics →')
      } finally {
        if (originalGa4Key === undefined) delete process.env.GA4_API_KEY; else process.env.GA4_API_KEY = originalGa4Key
        if (originalGa4Prop === undefined) delete process.env.GA4_PROPERTY_ID; else process.env.GA4_PROPERTY_ID = originalGa4Prop
      }
    })
  })

  describe('etsy_integration: rebuilt to call the real Etsy Open API v3 with ETSY_API_KEY instead of fabricating', () => {
    const src = readFileSync(new URL('../src/lib/autonomy-tools.ts', import.meta.url), 'utf8')
    const fnSrc = src.slice(src.indexOf('export async function toolEtsyIntegration'), src.indexOf('export async function toolAmazonIntegration'))

    test('no more fabricated hardcoded sales figures', () => {
      expect(fnSrc).not.toContain('Agent007Designs')
      expect(fnSrc).not.toContain('$148 revenue')
      expect(fnSrc).not.toContain('$248.50')
      expect(fnSrc).not.toContain('287 days')
    })

    test('requires ETSY_API_KEY and makes a real fetch to the Etsy Open API', () => {
      expect(fnSrc).toContain('process.env.ETSY_API_KEY')
      expect(fnSrc).toContain('openapi.etsy.com/v3/application/shops')
      expect(fnSrc).toContain("'x-api-key': key")
    })

    test('honestly discloses the OAuth limitation instead of fabricating revenue/order data', () => {
      expect(fnSrc).toContain('OAuth 2.0')
      expect(fnSrc).toContain('cannot report current sales/revenue')
    })
  })
})

// User-requested round: "External World Intelligence" upgrades applied in priority order --
// discoverability -> risks-query gap -> Alpha Vantage news/sentiment -> GDELT -> source-tier
// widening -> the "full access" overclaim.
describe('External World Intelligence upgrades', () => {
  describe('discoverability: smart_tool_router keyword map and the always-shown discovery prompt now surface the real tools', () => {
    const routerSrc = readFileSync(new URL('../src/lib/performance-booster-tools.ts', import.meta.url), 'utf8')

    test('the search category lists the real credential-gated engines, not only the old free fallbacks', () => {
      const mapSrc = routerSrc.slice(routerSrc.indexOf('const toolMap'), routerSrc.indexOf('const taskLower'))
      for (const realTool of ['tavily_search', 'exa_search', 'serpapi', 'brave_ai_search', 'perplexity_ai_search', 'you_com_search', 'google_ai_search', 'multi_search_compare', 'gdelt_search']) {
        expect(mapSrc).toContain(`'${realTool}'`)
      }
    })

    test('a dedicated finance/stock/crypto/payment category now exists, not folded into fabricated-sounding "money" tools alone', () => {
      const mapSrc = routerSrc.slice(routerSrc.indexOf('const toolMap'), routerSrc.indexOf('const taskLower'))
      expect(mapSrc).toContain("'finance':")
      for (const realTool of ['yahoo_finance', 'coingecko', 'finnhub_quote', 'alpha_vantage', 'alpha_vantage_news', 'fred_economic']) {
        expect(mapSrc).toContain(`'${realTool}'`)
      }
      expect(mapSrc).toContain("'payment':")
      expect(mapSrc).toContain("'stripe_payment_processor'")
      expect(mapSrc).toContain("'paypal_api'")
    })

    test('getToolDiscoveryPrompt names the highest-value search/finance/payment tools directly, not just a bare count', async () => {
      const prompt = await getToolDiscoveryPrompt()
      expect(prompt).toContain('tavily_search')
      expect(prompt).toContain('finnhub_quote')
      expect(prompt).toContain('alpha_vantage_news')
      expect(prompt).toContain('gdelt_search')
      expect(prompt).toContain('stripe_payment_processor')
      expect(prompt).toContain('paypal_api')
      expect(prompt).toMatch(/tools available/)
    })
  })

  describe('risks-query gap: equity research now proactively searches for disconfirming evidence', () => {
    test('buildExternalEvidencePlan generates a risks-purpose query per ticker for a public_equity decision', () => {
      const plan = buildExternalEvidencePlan({ objective: 'Should I invest in Geospace Technologies (GEOS)?', evidenceClass: 'external_web', domain: 'public_equity', operation: 'decide', temporalScope: 'current', evidenceProfile: 'public_equity' })
      const purposes = plan.queries.map((q) => q.purpose)
      expect(purposes).toContain('risks')
      const risksQuery = plan.queries.find((q) => q.purpose === 'risks')
      expect(risksQuery?.query).toMatch(/debt|dilution|lawsuit|insider selling/)
    })

    test('the query cap was raised so the risks query does not crowd out the multi-ticker comparison query', () => {
      const plan = buildExternalEvidencePlan({ objective: 'Compare Geospace Technologies (GEOS) and MIND Technology (MIND)', evidenceClass: 'external_web', domain: 'public_equity', operation: 'decide', temporalScope: 'current', evidenceProfile: 'public_equity' })
      const purposes = plan.queries.map((q) => q.purpose)
      expect(purposes.filter((p) => p === 'risks').length).toBe(2)
      expect(purposes).toContain('comparison')
    })
  })

  describe('Alpha Vantage news/sentiment: real articles via the already-configured ALPHA_VANTAGE_API_KEY', () => {
    test('requires a "tickers" or "topics" argument', async () => {
      const { toolAlphaVantageNews } = await import('@/lib/ai-providers-integration')
      process.env.ALPHA_VANTAGE_API_KEY = 'test-key'
      try {
        const result = await toolAlphaVantageNews({})
        expect(result.ok).toBe(false)
        expect(result.result).toContain('requires "tickers" or "topics"')
      } finally { delete process.env.ALPHA_VANTAGE_API_KEY }
    })

    test('honestly fails when ALPHA_VANTAGE_API_KEY is not set', async () => {
      const { toolAlphaVantageNews } = await import('@/lib/ai-providers-integration')
      delete process.env.ALPHA_VANTAGE_API_KEY
      const result = await toolAlphaVantageNews({ tickers: 'AAPL' })
      expect(result.ok).toBe(false)
      expect(result.result).toContain('ALPHA_VANTAGE_API_KEY')
    })

    test('returns real per-article and per-ticker sentiment, formatted with URL: labels, when the API call succeeds', async () => {
      const { toolAlphaVantageNews } = await import('@/lib/ai-providers-integration')
      const originalFetch = globalThis.fetch
      process.env.ALPHA_VANTAGE_API_KEY = 'test-key'
      globalThis.fetch = (async () => new Response(JSON.stringify({
        feed: [{ title: 'Example headline', url: 'https://example.com/article', source: 'Example Wire', time_published: '20260101T120000', overall_sentiment_label: 'Bullish', overall_sentiment_score: 0.4, summary: 'A summary.', ticker_sentiment: [{ ticker: 'AAPL', ticker_sentiment_label: 'Bullish', ticker_sentiment_score: '0.4' }] }],
      }), { status: 200 })) as typeof fetch
      try {
        const result = await toolAlphaVantageNews({ tickers: 'AAPL' })
        expect(result.ok).toBe(true)
        expect(result.result).toContain('URL: https://example.com/article')
        expect(result.result).toContain('AAPL: Bullish')
      } finally {
        globalThis.fetch = originalFetch
        delete process.env.ALPHA_VANTAGE_API_KEY
      }
    })

    test('registered in TOOL_REGISTRY and the finance capability domain', () => {
      const toolsSrc = readFileSync(new URL('../src/lib/tools.ts', import.meta.url), 'utf8')
      expect(toolsSrc).toContain('TOOL_REGISTRY.alpha_vantage_news')
      const capSrc = readFileSync(new URL('../src/lib/ceo-capability-architecture.ts', import.meta.url), 'utf8')
      expect(capSrc).toContain("tool('alpha_vantage_news'")
    })
  })

  describe('GDELT: free, no-key global/multilingual news search closes the "Global Events" gap', () => {
    const src = readFileSync(new URL('../src/lib/free-search-tools.ts', import.meta.url), 'utf8')
    const fnSrc = src.slice(src.indexOf('export async function toolGdeltSearch'))

    test('makes a real fetch to the GDELT DOC 2.0 API, requires no API key', () => {
      expect(fnSrc).toContain('api.gdeltproject.org/api/v2/doc/doc')
      expect(fnSrc).not.toContain('process.env')
    })

    test('honestly reports zero results rather than fabricating articles', () => {
      expect(fnSrc).toContain('No real-time global news articles matched')
    })

    test('registered in TOOL_REGISTRY, wired into research and market_intelligence domains, and dispatchable as a query-shaped search tool', () => {
      const toolsSrc = readFileSync(new URL('../src/lib/tools.ts', import.meta.url), 'utf8')
      expect(toolsSrc).toContain('TOOL_REGISTRY.gdelt_search')
      const capSrc = readFileSync(new URL('../src/lib/ceo-capability-architecture.ts', import.meta.url), 'utf8')
      expect(capSrc).toContain("tool('gdelt_search'")
      const executorSrc = readFileSync(new URL('../src/lib/ceo-evidence-executor.ts', import.meta.url), 'utf8')
      expect(executorSrc).toContain("'gdelt_search'")
    })
  })

  describe('source-tier widening: more reputable domains now get real authority tiers instead of defaulting to tier 4', () => {
    test('newly recognized domains resolve to the expected tier', () => {
      expect(sourceTierForUrl('https://fred.stlouisfed.org/series/GDP')).toBe(1)
      expect(sourceTierForUrl('https://finance.yahoo.com/quote/GEOS')).toBe(2)
      expect(sourceTierForUrl('https://www.morningstar.com/stocks/xnas/geos')).toBe(2)
      expect(sourceTierForUrl('https://www.ft.com/content/example')).toBe(3)
      expect(sourceTierForUrl('https://apnews.com/article/example')).toBe(3)
      expect(sourceTierForUrl('https://www.marketwatch.com/story/example')).toBe(3)
    })

    test('still does not over-rank lookalike domains, and existing tier-1/2/3 hosts are unchanged', () => {
      expect(sourceTierForUrl('https://investorplace.com/article/example')).toBe(4)
      expect(sourceTierForUrl('https://www.sec.gov/files/company_tickers.json')).toBe(1)
      expect(sourceTierForUrl('https://www.nasdaq.com/market-activity/stocks/geos')).toBe(2)
      expect(sourceTierForUrl('https://www.reuters.com/example')).toBe(3)
    })
  })

  describe('"Full access, no limitations" overclaim: agent007-extensions.ts now reports an honest ACCESS line', () => {
    const src = readFileSync(new URL('../src/lib/agent007-extensions.ts', import.meta.url), 'utf8')

    test('no longer hardcodes the blanket claim', () => {
      expect(src).not.toContain('CAPABILITY STATUS: Full access, no limitations.')
    })

    test('llm() returns a discriminated result instead of collapsing failure into an indistinguishable string', () => {
      const fnSrc = src.slice(src.indexOf('async function llm('), src.indexOf('/** Factory'))
      expect(fnSrc).toContain('{ ok: true; content: string }')
      expect(fnSrc).toContain('{ ok: false; error: string }')
    })

    test('createTool reports success and failure as two genuinely different ACCESS lines', () => {
      const fnSrc = src.slice(src.indexOf('function createTool'), src.indexOf('function createTool') + 2000)
      expect(fnSrc).toContain('ACCESS: available')
      expect(fnSrc).toContain('ACCESS: partial')
      expect(fnSrc).toContain('LLM analysis call failed')
    })
  })
})

// User-requested round 2: a fresh, skeptical re-audit of the 6 items above (dispatched to an
// Explore subagent) found the wiring largely sound but surfaced 3 real gaps -- fixed here.
describe('Round-2 deep re-audit fixes', () => {
  describe('risks-query starvation for 3+ tickers: equityQueries() now orders by purpose-round instead of ticker-then-purpose', () => {
    test('every requested ticker keeps its risks query regardless of how many tickers are in the request', () => {
      for (const n of [1, 2, 3, 5, 8]) {
        const tickers = Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i).repeat(3))
        const objective = tickers.map((t) => `(${t})`).join(' vs ')
        const plan = buildExternalEvidencePlan({ objective, evidenceClass: 'external_web', domain: 'public_equity', operation: 'decide', temporalScope: 'current', evidenceProfile: 'public_equity' })
        const risksCount = plan.queries.filter((q) => q.purpose === 'risks').length
        expect(risksCount).toBe(n)
      }
    })

    test('market and financials queries are also never starved, even at the 8-ticker max extractEquityTickers allows', () => {
      const tickers = Array.from({ length: 8 }, (_, i) => String.fromCharCode(65 + i).repeat(3))
      const objective = tickers.map((t) => `(${t})`).join(' vs ')
      const plan = buildExternalEvidencePlan({ objective, evidenceClass: 'external_web', domain: 'public_equity', operation: 'decide', temporalScope: 'current', evidenceProfile: 'public_equity' })
      const byPurpose = plan.queries.reduce((acc: Record<string, number>, q) => { acc[q.purpose] = (acc[q.purpose] ?? 0) + 1; return acc }, {})
      expect(byPurpose.market).toBe(8)
      expect(byPurpose.financials).toBe(8)
      expect(byPurpose.risks).toBe(8)
    })

    test('maxSearchQueries always equals the actual planned query count, so nothing silently gets dropped a second time by the executor', () => {
      for (const n of [1, 2, 3, 8]) {
        const tickers = Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i).repeat(3))
        const objective = tickers.map((t) => `(${t})`).join(' vs ')
        const plan = buildExternalEvidencePlan({ objective, evidenceClass: 'external_web', domain: 'public_equity', operation: 'decide', temporalScope: 'current', evidenceProfile: 'public_equity' })
        expect(plan.maxSearchQueries).toBe(plan.queries.length)
      }
    })
  })

  describe('source_quality_ranker no longer contradicts sourceTierForUrl, the gate decision-grade evidence actually uses', () => {
    test('financial/government hosts sourceTierForUrl recognizes but the old hand-curated list never listed now rank correctly instead of "Unknown source"', async () => {
      const { toolSourceQualityRanker } = await import('@/lib/multi-search-comparison')
      const result = await toolSourceQualityRanker({ urls: ['https://fred.stlouisfed.org/series/GDP', 'https://www.nasdaq.com/market-activity', 'https://www.ft.com/content/x'] })
      expect(result.ok).toBe(true)
      expect(result.result).toContain('TIER A')
      expect(result.result).not.toContain('Unknown source — moderate reliability] https://fred.stlouisfed.org')
    })

    test('curated entries (Wikipedia, Reuters, Reddit, ...) are unaffected -- the fallback only applies when nothing in SOURCE_RANKINGS matches', async () => {
      const { toolSourceQualityRanker } = await import('@/lib/multi-search-comparison')
      const result = await toolSourceQualityRanker({ urls: ['https://en.wikipedia.org/wiki/Test', 'https://www.reddit.com/r/test'] })
      expect(result.ok).toBe(true)
      expect(result.result).toContain('Encyclopedic, well-sourced, community-reviewed')
      expect(result.result).toContain('User-generated — community moderated but unreliable')
    })

    test('a domain sourceTierForUrl also does not recognize still falls back to the honest generic default', async () => {
      const { toolSourceQualityRanker } = await import('@/lib/multi-search-comparison')
      const result = await toolSourceQualityRanker({ urls: ['https://totally-unrecognized-blog.example/post'] })
      expect(result.ok).toBe(true)
      expect(result.result).toContain('Unknown source — moderate reliability')
    })
  })

  describe('"full access, no limitations" overclaim: the same bug pattern is now fixed in the two sibling files it was still live in', () => {
    test('enhanced-tools.ts no longer hardcodes the blanket claim and its llm() helper is discriminated', () => {
      const src = readFileSync(new URL('../src/lib/enhanced-tools.ts', import.meta.url), 'utf8')
      expect(src).not.toContain('full access, no limitations')
      expect(src).toContain('LlmResult = { ok: true; content: string } | { ok: false; error: string }')
      expect(src).toContain('function reportFrom(')
      expect(src).toContain('degraded')
    })

    test('all 19 enhanced-tools.ts call sites that use the LLM route through reportFrom(), not a hardcoded status string', () => {
      const src = readFileSync(new URL('../src/lib/enhanced-tools.ts', import.meta.url), 'utf8')
      const reportFromCalls = src.match(/reportFrom\(/g) ?? []
      // 1 definition + 19 call sites
      expect(reportFromCalls.length).toBe(20)
      expect(src).not.toMatch(/CAPABILITY STATUS: [A-Za-z ]+ active\.`\)/)
    })

    test('developer-enhancements.ts no longer hardcodes the blanket claim across all 12 dev tools (shared createDevTool factory)', () => {
      const src = readFileSync(new URL('../src/lib/developer-enhancements.ts', import.meta.url), 'utf8')
      expect(src).not.toContain('full access, no limitations')
      expect(src).toContain('Developer enhancement degraded')
      expect(src).toContain('Developer enhancement active — real analysis from a live LLM call this turn.')
      const devToolCount = (src.match(/createDevTool\(\{/g) ?? []).length
      expect(devToolCount).toBe(12)
    })
  })
})

// User-requested round 3: dedicated market-data providers (ROIC.ai, Tiingo, Polygon/Massive) and
// whole-site crawlers (Firecrawl, Spider.cloud).
describe('Round-3: market-data providers and site crawlers', () => {
  describe('ROIC.ai: historical OHLCV + financial statements', () => {
    test('both tools honestly require ROIC_API_KEY when unset', async () => {
      delete process.env.ROIC_API_KEY
      const prices = await toolRoicStockPrices({ ticker: 'AAPL' })
      expect(prices.ok).toBe(false)
      expect(prices.result).toContain('ROIC_API_KEY')
      const financials = await toolRoicFinancials({ ticker: 'AAPL' })
      expect(financials.ok).toBe(false)
      expect(financials.result).toContain('ROIC_API_KEY')
    })

    test('stock prices formats real OHLCV rows when the call succeeds', async () => {
      process.env.ROIC_API_KEY = 'test-key'
      const originalFetch = globalThis.fetch
      globalThis.fetch = (async () => new Response(JSON.stringify([{ date: '2026-01-02', open: 190, high: 195, low: 189, close: 193, adjClose: 193, volume: 1000000 }]), { status: 200 })) as typeof fetch
      try {
        const result = await toolRoicStockPrices({ ticker: 'AAPL' })
        expect(result.ok).toBe(true)
        expect(result.result).toContain('2026-01-02')
        expect(result.result).toContain('C=193')
      } finally { globalThis.fetch = originalFetch; delete process.env.ROIC_API_KEY }
    })

    test('financials rejects an unrecognized statement type before making a network call', async () => {
      process.env.ROIC_API_KEY = 'test-key'
      try {
        const result = await toolRoicFinancials({ ticker: 'AAPL', statement: 'not-a-real-statement' })
        expect(result.ok).toBe(false)
        expect(result.result).toContain('statement')
      } finally { delete process.env.ROIC_API_KEY }
    })

    test('round-2 deep-audit fix: an HTTP 200 with an error-shaped body fails honestly instead of rendering a fabricated placeholder table', async () => {
      process.env.ROIC_API_KEY = 'test-key'
      const originalFetch = globalThis.fetch
      globalThis.fetch = (async () => new Response(JSON.stringify({ error: 'invalid apikey' }), { status: 200 })) as typeof fetch
      try {
        const result = await toolRoicStockPrices({ ticker: 'AAPL' })
        expect(result.ok).toBe(false)
        expect(result.result).toContain('unexpected response shape')
        expect(result.result).not.toContain('O=- H=- L=- C=-')
      } finally { globalThis.fetch = originalFetch; delete process.env.ROIC_API_KEY }
    })
  })

  describe('Tiingo: daily OHLCV with inline split/dividend factors', () => {
    test('honestly requires TIINGO_API_KEY when unset (not yet configured by the owner)', async () => {
      delete process.env.TIINGO_API_KEY
      const result = await toolTiingoDaily({ ticker: 'AAPL' })
      expect(result.ok).toBe(false)
      expect(result.result).toContain('TIINGO_API_KEY')
    })

    test('surfaces per-day split factor and dividend cash as the corporate-actions signal', async () => {
      process.env.TIINGO_API_KEY = 'test-key'
      const originalFetch = globalThis.fetch
      globalThis.fetch = (async () => new Response(JSON.stringify([{ date: '2026-01-02T00:00:00.000Z', open: 190, high: 195, low: 189, close: 193, adjClose: 193, volume: 1000000, splitFactor: 1, divCash: 0.24 }]), { status: 200 })) as typeof fetch
      try {
        const result = await toolTiingoDaily({ ticker: 'AAPL' })
        expect(result.ok).toBe(true)
        expect(result.result).toContain('DivCash=0.24')
        expect(result.result).toContain('split/dividend factors')
      } finally { globalThis.fetch = originalFetch; delete process.env.TIINGO_API_KEY }
    })

    test('round-2 deep-audit fix: an HTTP 200 with an error-shaped body fails honestly instead of rendering a fabricated placeholder table', async () => {
      process.env.TIINGO_API_KEY = 'test-key'
      const originalFetch = globalThis.fetch
      globalThis.fetch = (async () => new Response(JSON.stringify({ detail: 'Not authorized' }), { status: 200 })) as typeof fetch
      try {
        const result = await toolTiingoDaily({ ticker: 'AAPL' })
        expect(result.ok).toBe(false)
        expect(result.result).toContain('unexpected response shape')
      } finally { globalThis.fetch = originalFetch; delete process.env.TIINGO_API_KEY }
    })
  })

  describe('Polygon (Massive): OHLCV aggregates + corporate actions', () => {
    test('both tools honestly require POLYGON_API_KEY when unset (not yet configured by the owner)', async () => {
      delete process.env.POLYGON_API_KEY
      const aggregates = await toolPolygonAggregates({ ticker: 'AAPL' })
      expect(aggregates.ok).toBe(false)
      expect(aggregates.result).toContain('POLYGON_API_KEY')
      const actions = await toolPolygonCorporateActions({ ticker: 'AAPL' })
      expect(actions.ok).toBe(false)
      expect(actions.result).toContain('POLYGON_API_KEY')
    })

    test('aggregates formats real OHLCV bars when the call succeeds', async () => {
      process.env.POLYGON_API_KEY = 'test-key'
      const originalFetch = globalThis.fetch
      globalThis.fetch = (async () => new Response(JSON.stringify({ results: [{ t: 1767398400000, o: 190, h: 195, l: 189, c: 193, v: 1000000 }] }), { status: 200 })) as typeof fetch
      try {
        const result = await toolPolygonAggregates({ ticker: 'AAPL' })
        expect(result.ok).toBe(true)
        expect(result.result).toContain('C=193')
      } finally { globalThis.fetch = originalFetch; delete process.env.POLYGON_API_KEY }
    })

    test('corporate actions formats real split events when the call succeeds', async () => {
      process.env.POLYGON_API_KEY = 'test-key'
      const originalFetch = globalThis.fetch
      globalThis.fetch = (async () => new Response(JSON.stringify({ results: [{ execution_date: '2020-08-31', split_from: 1, split_to: 4 }] }), { status: 200 })) as typeof fetch
      try {
        const result = await toolPolygonCorporateActions({ ticker: 'AAPL', kind: 'splits' })
        expect(result.ok).toBe(true)
        expect(result.result).toContain('1-for-4 split')
      } finally { globalThis.fetch = originalFetch; delete process.env.POLYGON_API_KEY }
    })

    test('rejects an unrecognized "kind" before making a network call', async () => {
      process.env.POLYGON_API_KEY = 'test-key'
      try {
        const result = await toolPolygonCorporateActions({ ticker: 'AAPL', kind: 'mergers' })
        expect(result.ok).toBe(false)
      } finally { delete process.env.POLYGON_API_KEY }
    })
  })

  describe('Firecrawl: keyless-capable scrape, credential-gated map/crawl', () => {
    test('scrape works without FIRECRAWL_API_KEY (keyless tier)', async () => {
      delete process.env.FIRECRAWL_API_KEY
      const originalFetch = globalThis.fetch
      let sawAuthHeader = false
      globalThis.fetch = (async (_url: any, init: any) => {
        sawAuthHeader = Boolean(init?.headers?.Authorization)
        return new Response(JSON.stringify({ data: { markdown: 'content', metadata: { title: 'T' } } }), { status: 200 })
      }) as typeof fetch
      try {
        const result = await toolFirecrawlScrape({ url: 'https://example.com' })
        expect(result.ok).toBe(true)
        expect(sawAuthHeader).toBe(false)
      } finally { globalThis.fetch = originalFetch }
    })

    test('scrape attaches Authorization when FIRECRAWL_API_KEY is set', async () => {
      process.env.FIRECRAWL_API_KEY = 'fc-test'
      const originalFetch = globalThis.fetch
      let authHeader = ''
      globalThis.fetch = (async (_url: any, init: any) => {
        authHeader = init?.headers?.Authorization ?? ''
        return new Response(JSON.stringify({ data: { markdown: 'content', metadata: { title: 'T' } } }), { status: 200 })
      }) as typeof fetch
      try {
        await toolFirecrawlScrape({ url: 'https://example.com' })
        expect(authHeader).toBe('Bearer fc-test')
      } finally { globalThis.fetch = originalFetch; delete process.env.FIRECRAWL_API_KEY }
    })

    test('map honestly requires FIRECRAWL_API_KEY (not available in keyless mode)', async () => {
      delete process.env.FIRECRAWL_API_KEY
      const result = await toolFirecrawlMap({ url: 'https://example.com' })
      expect(result.ok).toBe(false)
      expect(result.result).toContain('FIRECRAWL_API_KEY')
    })

    test('map formats discovered URLs with URL: labels for evidence extraction', async () => {
      process.env.FIRECRAWL_API_KEY = 'fc-test'
      const originalFetch = globalThis.fetch
      globalThis.fetch = (async () => new Response(JSON.stringify({ links: ['https://example.com/a', 'https://example.com/b'] }), { status: 200 })) as typeof fetch
      try {
        const result = await toolFirecrawlMap({ url: 'https://example.com' })
        expect(result.ok).toBe(true)
        expect(result.result).toContain('URL: https://example.com/a')
      } finally { globalThis.fetch = originalFetch; delete process.env.FIRECRAWL_API_KEY }
    })

    test('crawl honestly requires FIRECRAWL_API_KEY (not available in keyless mode)', async () => {
      delete process.env.FIRECRAWL_API_KEY
      const result = await toolFirecrawlCrawl({ url: 'https://example.com' })
      expect(result.ok).toBe(false)
      expect(result.result).toContain('FIRECRAWL_API_KEY')
    })

    test('crawl reports honestly when the async job is still running, instead of fabricating completion', async () => {
      // Calls pollFirecrawlJob directly with a short poll interval so this exercises the real
      // "still running past the budget" branch without waiting out the production 2.5s cadence.
      const originalFetch = globalThis.fetch
      let callCount = 0
      globalThis.fetch = (async () => { callCount++; return new Response(JSON.stringify({ status: 'scraping', completed: 2, total: 10 }), { status: 200 }) }) as typeof fetch
      try {
        const result = await pollFirecrawlJob('job-123', 'fc-test', 120, 20)
        expect(result.ok).toBe(true)
        expect(result.result).toContain('still running')
        expect(result.result).toContain('job-123')
        expect(callCount).toBeGreaterThan(1)
      } finally { globalThis.fetch = originalFetch }
    })

    test('round-2 deep-audit fix: a non-positive budgetMs still performs at least one real check instead of claiming "still running" unchecked', async () => {
      const originalFetch = globalThis.fetch
      let callCount = 0
      globalThis.fetch = (async () => { callCount++; return new Response(JSON.stringify({ status: 'completed', data: [] }), { status: 200 }) }) as typeof fetch
      try {
        const result = await pollFirecrawlJob('job-zero-budget', 'fc-test', 0, 20)
        expect(callCount).toBe(1)
        expect(result.ok).toBe(true)
        expect(result.result).toContain('completed')
      } finally { globalThis.fetch = originalFetch }
    })

    test('round-2 deep-audit fix: a transient HTTP error mid-poll is retried within budget instead of aborting the whole check', async () => {
      const originalFetch = globalThis.fetch
      let callCount = 0
      globalThis.fetch = (async () => {
        callCount++
        if (callCount === 1) return new Response('Service Unavailable', { status: 503 })
        return new Response(JSON.stringify({ status: 'completed', data: [] }), { status: 200 })
      }) as typeof fetch
      try {
        const result = await pollFirecrawlJob('job-transient-error', 'fc-test', 200, 20)
        expect(callCount).toBeGreaterThan(1)
        expect(result.ok).toBe(true)
        expect(result.result).toContain('completed')
      } finally { globalThis.fetch = originalFetch }
    })

    test('round-2 deep-audit fix: if EVERY attempt fails, reports a real failure rather than fabricating "still running"', async () => {
      const originalFetch = globalThis.fetch
      globalThis.fetch = (async () => new Response('Service Unavailable', { status: 503 })) as typeof fetch
      try {
        const result = await pollFirecrawlJob('job-always-fails', 'fc-test', 60, 20)
        expect(result.ok).toBe(false)
        expect(result.result).toContain('could not check job')
      } finally { globalThis.fetch = originalFetch }
    })

    test('round-2 deep-audit fix: a non-numeric "limit" falls back to the default instead of sending NaN/null to the API', async () => {
      process.env.FIRECRAWL_API_KEY = 'fc-test'
      const originalFetch = globalThis.fetch
      let sentLimit: any
      globalThis.fetch = (async (url: any, init: any) => {
        if (String(url).endsWith('/v2/crawl')) { sentLimit = JSON.parse(init.body).limit; return new Response(JSON.stringify({ id: 'job-nan' }), { status: 200 }) }
        return new Response(JSON.stringify({ status: 'completed', data: [] }), { status: 200 })
      }) as typeof fetch
      try {
        await toolFirecrawlCrawl({ url: 'https://example.com', limit: 'not-a-number' })
        expect(sentLimit).toBe(50)
        expect(Number.isFinite(sentLimit)).toBe(true)
      } finally { globalThis.fetch = originalFetch; delete process.env.FIRECRAWL_API_KEY }
    })

    test('crawl starts a new job for a "url" argument and formats the completed result', async () => {
      process.env.FIRECRAWL_API_KEY = 'fc-test'
      const originalFetch = globalThis.fetch
      globalThis.fetch = (async (url: any) => {
        if (String(url).endsWith('/v2/crawl')) return new Response(JSON.stringify({ id: 'job-new' }), { status: 200 })
        return new Response(JSON.stringify({ status: 'completed', data: [{ metadata: { title: 'Page', sourceURL: 'https://example.com/a' }, markdown: 'content' }] }), { status: 200 })
      }) as typeof fetch
      try {
        const result = await toolFirecrawlCrawl({ url: 'https://example.com', limit: 10 })
        expect(result.ok).toBe(true)
        expect(result.result).toContain('job-new')
        expect(result.result).toContain('completed')
      } finally { globalThis.fetch = originalFetch; delete process.env.FIRECRAWL_API_KEY }
    })

    test('crawl resumes an existing job via job_id instead of starting a duplicate crawl', async () => {
      process.env.FIRECRAWL_API_KEY = 'fc-test'
      const originalFetch = globalThis.fetch
      let startedNewJob = false
      globalThis.fetch = (async (url: any) => {
        if (String(url).endsWith('/v2/crawl')) { startedNewJob = true; return new Response(JSON.stringify({ id: 'unexpected' }), { status: 200 }) }
        return new Response(JSON.stringify({ status: 'completed', data: [{ metadata: { title: 'Page', sourceURL: 'https://example.com/a' }, markdown: 'content' }] }), { status: 200 })
      }) as typeof fetch
      try {
        const result = await toolFirecrawlCrawl({ job_id: 'existing-job' })
        expect(result.ok).toBe(true)
        expect(startedNewJob).toBe(false)
        expect(result.result).toContain('completed')
      } finally { globalThis.fetch = originalFetch; delete process.env.FIRECRAWL_API_KEY }
    })
  })

  describe('Spider.cloud: anti-bot-resistant scrape/crawl fallback', () => {
    test('both tools honestly require SPIDER_API_KEY when unset', async () => {
      delete process.env.SPIDER_API_KEY
      const scrape = await toolSpiderScrape({ url: 'https://example.com' })
      expect(scrape.ok).toBe(false)
      expect(scrape.result).toContain('SPIDER_API_KEY')
      const crawl = await toolSpiderCrawl({ url: 'https://example.com' })
      expect(crawl.ok).toBe(false)
      expect(crawl.result).toContain('SPIDER_API_KEY')
    })

    test('scrape returns real content when the call succeeds', async () => {
      process.env.SPIDER_API_KEY = 'sk-test'
      const originalFetch = globalThis.fetch
      globalThis.fetch = (async () => new Response(JSON.stringify({ content: 'page content', title: 'T' }), { status: 200 })) as typeof fetch
      try {
        const result = await toolSpiderScrape({ url: 'https://example.com' })
        expect(result.ok).toBe(true)
        expect(result.result).toContain('page content')
      } finally { globalThis.fetch = originalFetch; delete process.env.SPIDER_API_KEY }
    })

    test('round-2 deep-audit fix: a non-numeric "limit" falls back to the default instead of sending NaN/null to the API', async () => {
      process.env.SPIDER_API_KEY = 'sk-test'
      const originalFetch = globalThis.fetch
      let sentBody: any = null
      globalThis.fetch = (async (_url: any, init: any) => { sentBody = JSON.parse(init.body); return new Response(JSON.stringify({ content: 'page content' }), { status: 200 }) }) as typeof fetch
      try {
        await toolSpiderCrawl({ url: 'https://example.com', limit: 'not-a-number' })
        expect(sentBody.limit).toBe(20)
        expect(Number.isFinite(sentBody.limit)).toBe(true)
      } finally { globalThis.fetch = originalFetch; delete process.env.SPIDER_API_KEY }
    })
  })

  describe('all 10 new tools are registered, capability-wired, and discoverable', () => {
    test('registered in TOOL_REGISTRY', () => {
      const toolsSrc = readFileSync(new URL('../src/lib/tools.ts', import.meta.url), 'utf8')
      for (const id of ['roic_stock_prices', 'roic_financials', 'tiingo_daily', 'polygon_aggregates', 'polygon_corporate_actions', 'firecrawl_scrape', 'firecrawl_map', 'firecrawl_crawl', 'spider_scrape', 'spider_crawl']) {
        expect(toolsSrc).toContain(`TOOL_REGISTRY.${id}`)
      }
    })

    test('wired into the finance and research capability domains (including the crawl tools -- selectCeoTool draws its candidate pool exclusively from this architecture, so a tool absent here is structurally unreachable by scored selection even if registered everywhere else)', () => {
      const capSrc = readFileSync(new URL('../src/lib/ceo-capability-architecture.ts', import.meta.url), 'utf8')
      for (const id of ['roic_stock_prices', 'roic_financials', 'tiingo_daily', 'polygon_aggregates', 'polygon_corporate_actions']) expect(capSrc).toContain(`tool('${id}'`)
      for (const id of ['firecrawl_scrape', 'firecrawl_map', 'firecrawl_crawl', 'spider_scrape', 'spider_crawl']) expect(capSrc).toContain(`tool('${id}'`)
    })

    test('named in the tool discovery prompt so the CEO can learn they exist', async () => {
      const prompt = await getToolDiscoveryPrompt()
      expect(prompt).toContain('firecrawl_map')
      expect(prompt).toContain('tiingo_daily')
      expect(prompt).toContain('polygon_aggregates')
      expect(prompt).toContain('polygon_corporate_actions')
    })

    test('none of the 9 are in QUERY_SEARCH_TOOL_IDS -- they take url/ticker, not query, and would fail if the deterministic evidence pipeline dispatched them search-shaped', () => {
      const executorSrc = readFileSync(new URL('../src/lib/ceo-evidence-executor.ts', import.meta.url), 'utf8')
      const setLiteral = executorSrc.slice(executorSrc.indexOf('QUERY_SEARCH_TOOL_IDS = new Set('), executorSrc.indexOf('])'))
      for (const id of ['roic_stock_prices', 'roic_financials', 'tiingo_daily', 'polygon_aggregates', 'polygon_corporate_actions', 'firecrawl_scrape', 'firecrawl_map', 'firecrawl_crawl', 'spider_scrape', 'spider_crawl']) {
        expect(setLiteral).not.toContain(`'${id}'`)
      }
    })
  })
})

// Part c full completion: Financial Evidence Graph, temporal timeline, continuous monitoring.
describe('Part c: Financial Evidence Graph, temporal timeline, continuous monitoring', () => {
  describe('Financial Evidence Graph: real co-occurrence, never an asserted business relationship', () => {
    test('coOccurringEntityPairs finds pairs regardless of listing order, and de-dupes repeat co-occurrence into one candidate', () => {
      const pairs = coOccurringEntityPairs({ sources: [
        { id: 's1', relatedEntities: ['AAPL', 'MSFT'] } as any,
        { id: 's2', relatedEntities: ['MSFT', 'AAPL'] } as any,
      ] })
      expect(pairs).toHaveLength(1)
      expect(pairs[0].fromKey).toBe('AAPL')
      expect(pairs[0].toKey).toBe('MSFT')
      expect(pairs[0].sourceIds).toEqual(['s1', 's2'])
    })

    test('a source with only one entity, or none, contributes no pairs', () => {
      expect(coOccurringEntityPairs({ sources: [{ id: 's1', relatedEntities: ['AAPL'] } as any] })).toHaveLength(0)
      expect(coOccurringEntityPairs({ sources: [{ id: 's1', relatedEntities: [] } as any] })).toHaveLength(0)
      expect(coOccurringEntityPairs({ sources: [{ id: 's1' } as any] })).toHaveLength(0)
    })

    test('three co-occurring entities in one source produce all three pairs', () => {
      const pairs = coOccurringEntityPairs({ sources: [{ id: 's1', relatedEntities: ['AAPL', 'MSFT', 'GOOG'] } as any] })
      expect(pairs).toHaveLength(3)
      const keys = pairs.map((p) => `${p.fromKey}-${p.toKey}`).sort()
      expect(keys).toEqual(['AAPL-GOOG', 'AAPL-MSFT', 'GOOG-MSFT'])
    })

    test('evidence_graph_query requires "ticker" and fails closed to an honest "not found" without a live database', async () => {
      const missing = await toolEvidenceGraphQuery({}, {} as any)
      expect(missing.ok).toBe(false)
      const result = await toolEvidenceGraphQuery({ ticker: 'AAPL' }, {} as any)
      expect(result.ok).toBe(true)
      expect(result.result).toContain('has not co-occurred')
    })

    test('registered, capability-wired (research domain), and named in the tool discovery prompt', async () => {
      const toolsSrc = readFileSync(new URL('../src/lib/tools.ts', import.meta.url), 'utf8')
      expect(toolsSrc).toContain('TOOL_REGISTRY.evidence_graph_query')
      const capSrc = readFileSync(new URL('../src/lib/ceo-capability-architecture.ts', import.meta.url), 'utf8')
      expect(capSrc).toContain("tool('evidence_graph_query'")
      const prompt = await getToolDiscoveryPrompt()
      expect(prompt).toContain('evidence_graph_query')
    })
  })

  describe('Evidence Timeline: honest events + candidate temporal correlations, never asserted causation', () => {
    test('buildTimeline sorts chronologically and flags only CONSECUTIVE events within the window', () => {
      const day = 86400000
      const base = Date.parse('2026-01-01T00:00:00Z')
      const events = [
        { at: base + 40 * day, kind: 'c', label: 'C', detail: '' },
        { at: base, kind: 'a', label: 'A', detail: '' },
        { at: base + 5 * day, kind: 'b', label: 'B', detail: '' },
      ]
      const { events: sorted, correlations } = buildTimeline(events, 14)
      expect(sorted.map((e) => e.kind)).toEqual(['a', 'b', 'c'])
      // A->B is 5 days apart (within 14-day window); B->C is 35 days apart (outside it).
      expect(correlations).toHaveLength(1)
      expect(correlations[0].earlier.kind).toBe('a')
      expect(correlations[0].later.kind).toBe('b')
      expect(correlations[0].gapDays).toBeCloseTo(5, 5)
    })

    test('zero or one event produces zero correlations', () => {
      expect(buildTimeline([], 14).correlations).toHaveLength(0)
      expect(buildTimeline([{ at: Date.now(), kind: 'a', label: 'A', detail: '' }], 14).correlations).toHaveLength(0)
    })

    test('evidence_timeline requires "ticker" and honestly reports no events without a live database or POLYGON_API_KEY', async () => {
      const missing = await toolEvidenceTimeline({}, {} as any)
      expect(missing.ok).toBe(false)
      delete process.env.POLYGON_API_KEY
      const result = await toolEvidenceTimeline({ ticker: 'AAPL' }, {} as any)
      expect(result.ok).toBe(true)
      expect(result.result).toContain('No verified, timestamped evidence events are on record yet')
    })

    test('registered, capability-wired (research domain), and named in the tool discovery prompt', async () => {
      const toolsSrc = readFileSync(new URL('../src/lib/tools.ts', import.meta.url), 'utf8')
      expect(toolsSrc).toContain('TOOL_REGISTRY.evidence_timeline')
      const capSrc = readFileSync(new URL('../src/lib/ceo-capability-architecture.ts', import.meta.url), 'utf8')
      expect(capSrc).toContain("tool('evidence_timeline'")
      const prompt = await getToolDiscoveryPrompt()
      expect(prompt).toContain('evidence_timeline')
    })
  })

  describe('Continuous monitoring (watch-and-alert): standing checks instead of query-time only', () => {
    test('watchThresholdBreached compares the absolute move against the threshold', () => {
      expect(watchThresholdBreached(6, 5)).toBe(true)
      expect(watchThresholdBreached(-6, 5)).toBe(true)
      expect(watchThresholdBreached(3, 5)).toBe(false)
      expect(watchThresholdBreached(5, 5)).toBe(true)
    })

    test('create_evidence_watch rejects a missing ticker or a non-positive threshold before touching the database', async () => {
      const noTicker = await toolCreateEvidenceWatch({ threshold_pct: 5 }, {} as any)
      expect(noTicker.ok).toBe(false)
      expect(noTicker.result).toContain('ticker')
      const badThreshold = await toolCreateEvidenceWatch({ ticker: 'AAPL', threshold_pct: -3 }, {} as any)
      expect(badThreshold.ok).toBe(false)
      expect(badThreshold.result).toContain('threshold_pct')
    })

    test('list_evidence_watches is a real async tool wrapper (validated by invoking it -- errors without a live database are expected and handled, not thrown)', async () => {
      const result = await toolListEvidenceWatches({}, {} as any)
      expect(typeof result.ok).toBe('boolean')
      expect(typeof result.result).toBe('string')
    })

    test('registered, capability-wired (finance domain), and named in the tool discovery prompt', async () => {
      const toolsSrc = readFileSync(new URL('../src/lib/tools.ts', import.meta.url), 'utf8')
      for (const id of ['create_evidence_watch', 'list_evidence_watches', 'check_evidence_watches']) expect(toolsSrc).toContain(`TOOL_REGISTRY.${id}`)
      const capSrc = readFileSync(new URL('../src/lib/ceo-capability-architecture.ts', import.meta.url), 'utf8')
      for (const id of ['create_evidence_watch', 'list_evidence_watches', 'check_evidence_watches']) expect(capSrc).toContain(`tool('${id}'`)
      const prompt = await getToolDiscoveryPrompt()
      expect(prompt).toContain('create_evidence_watch')
    })

    test('a protected cron route exists and is wired into the daily /api/schedules/tick dispatcher, matching this codebase\'s established daily-job pattern', () => {
      const routeSrc = readFileSync(new URL('../src/app/api/schedules/evidence-watch-check/route.ts', import.meta.url), 'utf8')
      expect(routeSrc).toContain('CRON_SECRET')
      expect(routeSrc).toContain('checkAllEvidenceWatches')
      const tickSrc = readFileSync(new URL('../src/app/api/schedules/tick/route.ts', import.meta.url), 'utf8')
      expect(tickSrc).toContain("fireDaily('/api/schedules/evidence-watch-check')")
    })
  })

  describe('Prisma schema and the raw-SQL reconciliation script stay in sync for all 4 new tables', () => {
    test('every new model in schema.prisma has a matching CREATE TABLE in reconcile-production-schema.ts, and vice versa', () => {
      const schemaSrc = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8')
      const reconcileSrc = readFileSync(new URL('../src/lib/reconcile-production-schema.ts', import.meta.url), 'utf8')
      for (const model of ['EvidenceEntityNode', 'EvidenceEntityEdge', 'EvidenceWatch', 'EvidenceWatchHit']) {
        expect(schemaSrc).toContain(`model ${model} {`)
        expect(reconcileSrc).toContain(`CREATE TABLE IF NOT EXISTS "${model}"`)
        expect(reconcileSrc).toContain(`'${model}'`) // present in the verification block's required-table list
      }
    })
  })
})
