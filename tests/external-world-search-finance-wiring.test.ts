import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { toolExaSearch, toolFinnhubQuote, toolSerpAPI, toolTavilySearch } from '@/lib/ai-providers-integration'
import { CEO_CAPABILITY_ARCHITECTURE, findCapability, findCapabilityForDomain } from '@/lib/ceo-capability-architecture'
import type { CeoExecutionContract } from '@/lib/ceo-cognitive-contract'
import { selectCeoTool } from '@/lib/ceo-tool-selection'
import { toolAPIIntegrationManager } from '@/lib/mission-lifecycle'
import { toolHealthChecker, toolSelfHealingTools } from '@/lib/tool-testing-coordination'

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
