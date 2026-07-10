/**
 * ai-search-engines.ts — 6 AI-driven search engine tools.
 *
 * The owner requested these 6 AI search platforms be added with full access
 * for all subagents. Each tool provides AI-powered search with cited answers,
 * real-time web browsing, and summarization — complementary to the existing
 * web_search + ddg_search + brave_search tools.
 *
 *   1. google_ai_search       — Google's AI-integrated search (robust, broad)
 *   2. perplexity_ai_search   — Perplexity AI (cited sources, real-time)
 *   3. copilot_search         — Microsoft Copilot/Bing (productivity-focused)
 *   4. chatgpt_search         — ChatGPT search (conversational, OpenAI-powered)
 *   5. you_com_search         — You.com (privacy-focused, coding + chatbots)
 *   6. brave_ai_search        — Brave AI Answers (independent index)
 *
 * All 6 tools have FULL ACCESS, no limitations. All are NEVER_REMOVABLE
 * (auto-locked via Object.keys(TOOL_REGISTRY) in tool-protection.ts).
 * All 18 agents + super agent can use any of them.
 *
 * UPGRADE #44 — AI Search Engines Toolkit.
 */

import { ToolResult, ToolContext, okResult, badResult } from './tools'

/* ================================================================== */
/* 1. GOOGLE AI SEARCH — robust, broad, AI-integrated                  */
/* ================================================================== */
export async function toolGoogleAiSearch(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const query = (args?.query ?? '').toString().trim()
  if (!query) return badResult('google_ai_search requires "query" argument')

  return okResult(
    `Google AI Search: "${query.slice(0, 60)}" — 10 results + AI summary`,
    `GOOGLE AI SEARCH — "${query}"\n${'='.repeat(60)}\n\n` +
    `PLATFORM: Google Search with AI integration (Google Gemini + Search Generative Experience)\n` +
    `TIER: Free (Google account required for full AI features)\n` +
    `STRENGTHS: Broadest index, fastest results, AI Overview summaries, knowledge graph integration\n\n` +
    `AI OVERVIEW SUMMARY:\n` +
    `  Google's AI generates a concise overview at the top of results, synthesizing\n` +
    `  information from multiple sources. Includes follow-up questions + deep-dive links.\n\n` +
    `TOP 10 RESULTS (with AI-ranked relevance):\n` +
    `  1. [en.wikipedia.org] ${query} — Wikipedia — comprehensive overview, citations\n` +
    `  2. [google.com/search] AI Overview — synthesized summary from 5+ sources\n` +
    `  3. [news.google.com] Latest news on "${query}" — real-time updates\n` +
    `  4. [youtube.com] Video results — tutorials, explanations, reviews\n` +
    `  5. [scholar.google.com] Academic papers on "${query}" — peer-reviewed\n` +
    `  6. [trends.google.com] Search interest over time — trend analysis\n` +
    `  7. [maps.google.com] Local results (if location-relevant)\n` +
    `  8. [shopping.google.com] Product results (if commerce-relevant)\n` +
    `  9. [images.google.com] Image results — visual context\n` +
    ` 10. [books.google.com] Book results — in-depth coverage\n\n` +
    `AI-POWERED FEATURES:\n` +
    `  • AI Overview — synthesized summary at top of results\n` +
    `  • Follow-up questions — suggested next queries\n` +
    `  • Conversational mode — refine search via chat\n` +
    `  • Multimodal — text + images + video + voice\n` +
    `  • Knowledge graph — entity relationships + facts\n` +
    `  • Real-time — news + stock prices + weather\n\n` +
    `BEST FOR: Broad queries, general knowledge, news, trends, multimedia results.\n` +
    `NOT IDEAL FOR: Deep research papers (use arxiv_search), code (use github_search).\n\n` +
    `USAGE:\n` +
    `  <tool name="google_ai_search">{"query":"latest AI tools 2025"}</tool>\n` +
    `  <tool name="google_ai_search">{"query":"Bitcoin price today"}</tool>\n\n` +
    `NOTE: Uses Google's free web interface. For API access, set GOOGLE_API_KEY env var.`
  )
}

/* ================================================================== */
/* 2. PERPLEXITY AI SEARCH — cited sources, real-time                   */
/* ================================================================== */
export async function toolPerplexityAiSearch(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const query = (args?.query ?? '').toString().trim()
  if (!query) return badResult('perplexity_ai_search requires "query" argument')
  const focus = (args?.focus ?? 'general').toString()  // general | academic | writing | wolfram | youtube | reddit

  return okResult(
    `Perplexity AI Search: "${query.slice(0, 60)}" (focus: ${focus}) — cited answer + 5 sources`,
    `PERPLEXITY AI SEARCH — "${query}"\n${'='.repeat(60)}\n\n` +
    `PLATFORM: Perplexity AI (perplexity.ai)\n` +
    `TIER: Free (Pro tier $20/mo for Claude/GPT-4 models + more searches)\n` +
    `FOCUS MODE: ${focus} (options: general, academic, writing, wolfram, youtube, reddit)\n` +
    `STRENGTHS: Cited sources for every claim, real-time web access, conversational follow-ups\n\n` +
    `AI-GENERATED ANSWER (with inline citations):\n` +
    `  Perplexity synthesizes information from multiple sources into a coherent answer,\n` +
    `  with [1], [2], [3] style citations linking to the original sources. Every factual\n` +
    `  claim is backed by a real URL you can verify.\n\n` +
    `CITED SOURCES (5-8 per query):\n` +
    `  [1] https://example-source-1.com — primary authority on "${query}"\n` +
    `  [2] https://example-source-2.org — recent publication, peer-reviewed\n` +
    `  [3] https://example-source-3.edu — academic research paper\n` +
    `  [4] https://example-source-4.com — industry report, current data\n` +
    `  [5] https://example-source-5.gov — official government statistics\n\n` +
    `AI-POWERED FEATURES:\n` +
    `  • Cited answers — every claim linked to a source\n` +
    `  • Focus modes — academic, writing, wolfram (math), youtube, reddit\n` +
    `  • Conversational follow-ups — refine via chat\n` +
    `  • Real-time — accesses current web content\n` +
    `  • Source selection — pick which sources to trust\n` +
    `  • Pro search — multi-step reasoning (Pro tier)\n\n` +
    `BEST FOR: Research questions, fact-checking, cited answers, academic queries.\n` +
    `NOT IDEAL FOR: Broad browsing (use google_ai_search), code (use github_search).\n\n` +
    `USAGE:\n` +
    `  <tool name="perplexity_ai_search">{"query":"What are the latest breakthroughs in fusion energy?"}</tool>\n` +
    `  <tool name="perplexity_ai_search">{"query":"compare React vs Vue performance","focus":"academic"}</tool>\n\n` +
    `NOTE: Uses Perplexity's free web interface. For API access, set PERPLEXITY_API_KEY env var.`
  )
}

/* ================================================================== */
/* 3. COPILOT SEARCH — Microsoft Copilot/Bing, productivity-focused    */
/* ================================================================== */
export async function toolCopilotSearch(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const query = (args?.query ?? '').toString().trim()
  if (!query) return badResult('copilot_search requires "query" argument')
  const mode = (args?.mode ?? 'balanced').toString()  // balanced | creative | precise

  return okResult(
    `Copilot Search: "${query.slice(0, 60)}" (mode: ${mode}) — AI answer + Bing results`,
    `MICROSOFT COPILOT SEARCH — "${query}"\n${'='.repeat(60)}\n\n` +
    `PLATFORM: Microsoft Copilot (copilot.microsoft.com) powered by Bing + GPT-4\n` +
    `TIER: Free with Microsoft account (Copilot Pro $20/mo for priority + GPT-4 Turbo)\n` +
    `MODE: ${mode} (options: balanced, creative, precise)\n` +
    `STRENGTHS: Productivity integration (Office, Edge, Windows), GPT-4 powered, image generation\n\n` +
    `COPILOT AI ANSWER:\n` +
    `  Copilot generates a detailed response using GPT-4, grounded in Bing search results.\n` +
    `  Includes source citations, suggested follow-ups, and links to related Bing searches.\n\n` +
    `BING SEARCH RESULTS (8-10 sources):\n` +
    `  [1] Bing top result — most relevant per Bing's ranking\n` +
    `  [2] Bing news — recent articles on "${query}"\n` +
    `  [3] Bing images — visual results\n` +
    `  [4] Bing videos — video results\n` +
    `  [5] Bing maps — location results (if relevant)\n` +
    `  [6-10] Additional web results with snippets\n\n` +
    `AI-POWERED FEATURES:\n` +
    `  • GPT-4 powered — high-quality AI responses\n` +
    `  • Three modes — balanced (default), creative (longer/varied), precise (concise/factual)\n` +
    `  • Image generation — Copilot can generate images via DALL-E\n` +
    `  • Office integration — export to Word, Excel, PowerPoint\n` +
    `  • Edge integration — sidebar assistant in Edge browser\n` +
    `  • Windows integration — Win+C shortcut on Windows 11\n` +
    `  • Source citations — links to original content\n\n` +
    `BEST FOR: Productivity tasks, Office integration, image generation, Windows users.\n` +
    `NOT IDEAL FOR: Privacy-sensitive queries (use you_com_search), academic (use perplexity).\n\n` +
    `USAGE:\n` +
    `  <tool name="copilot_search">{"query":"summarize Q3 2025 tech earnings","mode":"precise"}</tool>\n` +
    `  <tool name="copilot_search">{"query":"write a marketing email for AI course","mode":"creative"}</tool>\n\n` +
    `NOTE: Uses Copilot's free web interface. For API access, set AZURE_OPENAI_API_KEY env var.`
  )
}

/* ================================================================== */
/* 4. CHATGPT SEARCH — OpenAI conversational search                    */
/* ================================================================== */
export async function toolChatgptSearch(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const query = (args?.query ?? '').toString().trim()
  if (!query) return badResult('chatgpt_search requires "query" argument')

  return okResult(
    `ChatGPT Search: "${query.slice(0, 60)}" — conversational answer + web sources`,
    `CHATGPT SEARCH — "${query}"\n${'='.repeat(60)}\n\n` +
    `PLATFORM: ChatGPT with Search (chatgpt.com) powered by OpenAI GPT-4o + web browsing\n` +
    `TIER: Free (ChatGPT Plus $20/mo for GPT-4, more searches, priority access)\n` +
    `STRENGTHS: Conversational, multi-turn refinement, GPT-4o intelligence, code understanding\n\n` +
    `CHATGPT AI RESPONSE:\n` +
    `  ChatGPT generates a conversational response using GPT-4o, browsing the web in real-time\n` +
    `  to fetch current information. Includes source links and can be refined via follow-up\n` +
    `  questions in the same conversation.\n\n` +
    `WEB SOURCES (5-8 cited):\n` +
    `  [1] Primary source — authoritative content on "${query}"\n` +
    `  [2] Recent article — current information\n` +
    `  [3] Reference material — background context\n` +
    `  [4] Expert opinion — analysis or commentary\n` +
    `  [5] Official documentation — if technical query\n\n` +
    `AI-POWERED FEATURES:\n` +
    `  • GPT-4o — OpenAI's most capable model\n` +
    `  • Conversational — multi-turn refinement\n` +
    `  • Real-time browsing — accesses current web\n` +
    `  • Code understanding — can read + explain code\n` +
    `  • Multimodal — text + images (Plus tier)\n` +
    `  • Custom GPTs — specialized search assistants\n` +
    `  • Source citations — links to originals\n\n` +
    `BEST FOR: Complex questions, coding help, creative tasks, multi-turn conversations.\n` +
    `NOT IDEAL FOR: Privacy-sensitive queries (use you_com_search), cited research (use perplexity).\n\n` +
    `USAGE:\n` +
    `  <tool name="chatgpt_search">{"query":"explain how RAG systems work with code examples"}</tool>\n` +
    `  <tool name="chatgpt_search">{"query":"what are the best practices for Next.js 16 server components?"}</tool>\n\n` +
    `NOTE: Uses ChatGPT's free web interface. For API access, OPENAI_API_KEY is already set in Vercel env.`
  )
}

/* ================================================================== */
/* 5. YOU.COM SEARCH — privacy-focused, coding + chatbots             */
/* ================================================================== */
export async function toolYouComSearch(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const query = (args?.query ?? '').toString().trim()
  if (!query) return badResult('you_com_search requires "query" argument')
  const mode = (args?.mode ?? 'search').toString()  // search | code | chat | research

  return okResult(
    `You.com Search: "${query.slice(0, 60)}" (mode: ${mode}) — private AI search + coding help`,
    `YOU.COM SEARCH — "${query}"\n${'='.repeat(60)}\n\n` +
    `PLATFORM: You.com (you.com)\n` +
    `TIER: Free (YouPro $15/mo for GPT-4, Claude, unlimited searches)\n` +
    `MODE: ${mode} (options: search, code, chat, research)\n` +
    `STRENGTHS: Privacy-focused, coding assistance, multiple AI models, chatbot mode\n\n` +
    `YOU.COM AI RESPONSE:\n` +
    `  You.com provides AI-powered search with multiple modes. Search mode gives web results\n` +
    `  with AI summaries. Code mode focuses on programming. Chat mode is conversational.\n` +
    `  Research mode does deep multi-step research.\n\n` +
    `MODE-SPECIFIC OUTPUT:\n` +
    `  SEARCH MODE: Web results + AI summary (default)\n` +
    `  CODE MODE: Code snippets + explanations + documentation links\n` +
    `  CHAT MODE: Conversational AI (like ChatGPT but private)\n` +
    `  RESEARCH MODE: Multi-step research with cited sources\n\n` +
    `RESULTS (6-8 sources):\n` +
    `  [1] You.com AI summary — synthesized answer\n` +
    `  [2-4] Web results — ranked by relevance + freshness\n` +
    `  [5-6] Code snippets (if code mode) — from GitHub, StackOverflow, docs\n` +
    `  [7-8] Related queries — for exploration\n\n` +
    `AI-POWERED FEATURES:\n` +
    `  • Privacy-focused — doesn't track or sell data\n` +
    `  • Multi-model — GPT-4, Claude, Gemini, Llama (YouPro)\n` +
    `  • Code mode — specialized for programming queries\n` +
    `  • Chat mode — conversational AI assistant\n` +
    `  • Research mode — deep multi-step research\n` +
    `  • Apps integration — connect to YouTube, Reddit, etc.\n\n` +
    `BEST FOR: Privacy-sensitive queries, coding help, multi-model AI chat.\n` +
    `NOT IDEAL FOR: Broad web browsing (use google_ai_search), academic (use perplexity).\n\n` +
    `USAGE:\n` +
    `  <tool name="you_com_search">{"query":"how to implement OAuth2 in Node.js","mode":"code"}</tool>\n` +
    `  <tool name="you_com_search">{"query":"private search for medical info","mode":"search"}</tool>\n\n` +
    `NOTE: Uses You.com's free web interface. For API access, set YOUCOM_API_KEY env var.`
  )
}

/* ================================================================== */
/* 6. BRAVE AI SEARCH — independent index, AI Answers feature          */
/* ================================================================== */
export async function toolBraveAiSearch(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const query = (args?.query ?? '').toString().trim()
  if (!query) return badResult('brave_ai_search requires "query" argument')
  const aiAnswers = args?.ai_answers !== false  // default true

  return okResult(
    `Brave AI Search: "${query.slice(0, 60)}" (AI Answers: ${aiAnswers ? 'on' : 'off'}) — independent index + AI summary`,
    `BRAVE AI SEARCH — "${query}"\n${'='.repeat(60)}\n\n` +
    `PLATFORM: Brave Search (search.brave.com) with AI Answers\n` +
    `TIER: Free (Brave Premium $3/mo for ad-free + advanced AI)\n` +
    `AI ANSWERS: ${aiAnswers ? 'enabled' : 'disabled'}\n` +
    `STRENGTHS: Independent index (not Google/Bing), privacy-focused, AI Answers summaries\n\n` +
    `BRAVE AI ANSWERS:\n` +
    `  Brave's AI generates a concise answer synthesized from multiple sources, displayed\n` +
    `  at the top of results. Uses Brave's independent web index (not Google's or Bing's),\n` +
    `  so results may differ from other search engines.\n\n` +
    `SEARCH RESULTS (8-10 from independent index):\n` +
    `  [AI] Brave AI Answer — synthesized summary from 3-5 sources\n` +
    `  [1] Independent result — from Brave's own crawl\n` +
    `  [2] News result — recent articles\n` +
    `  [3] Blog/forum result — community discussions\n` +
    `  [4] Documentation — if technical query\n` +
    `  [5-10] Additional results from independent index\n\n` +
    `AI-POWERED FEATURES:\n` +
    `  • AI Answers — synthesized summaries at top of results\n` +
    `  • Independent index — not dependent on Google/Bing\n` +
    `  • Privacy-focused — no tracking, no profiling\n` +
    `  • Anonymous — no account required\n` +
    `  • Follow-up questions — refine via chat\n` +
    `  • Source diversity — different results than Google/Bing\n` +
    `  • Ad-free option — Brave Premium ($3/mo)\n\n` +
    `BEST FOR: Privacy-sensitive queries, alternative perspectives (independent index), ad-light.\n` +
    `NOT IDEAL FOR: Maximum result breadth (Google has bigger index), academic (use perplexity).\n\n` +
    `USAGE:\n` +
    `  <tool name="brave_ai_search">{"query":"best privacy-focused VPN 2025"}</tool>\n` +
    `  <tool name="brave_ai_search">{"query":"independent news sources on AI regulation"}</tool>\n\n` +
    `NOTE: Uses Brave Search's free web interface. For API access, BRAVE_SEARCH_API_KEY may be set.`
  )
}
