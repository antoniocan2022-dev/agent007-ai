/**
 * /api/health/full-audit — UPGRADE #116
 * Deep audit of ALL systems: LLM providers, Telegram, Discord, ntfy,
 * mission-active, subagents, dashboard, security headers, DB, etc.
 *
 * Runs live ping tests against each integration and returns a report card.
 * Use this single endpoint to verify "is everything working?".
 *
 * GET /api/health/full-audit              — full audit (no destructive tests)
 * GET /api/health/full-audit?deep=true    — also ping each external API
 */
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface Check {
  id: string
  name: string
  category: 'llm' | 'comms' | 'mission' | 'agent' | 'security' | 'db' | 'build'
  status: 'pass' | 'fail' | 'warn' | 'skip'
  detail: string
  evidence?: any
}

function mask(key: string | undefined): string {
  if (!key) return '(not set)'
  if (key.length <= 12) return `(set, len=${key.length})`
  return `${key.slice(0, 4)}…${key.slice(-4)} (len=${key.length})`
}

async function ping(url: string, opts: RequestInit = {}, timeoutMs = 8000): Promise<{ ok: boolean; status: number; body: string }> {
  try {
    const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(timeoutMs) })
    const body = await res.text().catch(() => '')
    return { ok: res.ok, status: res.status, body: body.slice(0, 500) }
  } catch (e: any) {
    return { ok: false, status: 0, body: e?.message || 'network error' }
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const deep = url.searchParams.get('deep') === 'true'
  // UPGRADE #116: Always use the public production URL for endpoint checks.
  // Calling url.origin from inside a serverless function can reuse warm
  // instance state OR hit a different instance with empty in-memory data,
  // producing false negatives. The public URL gives consistent fresh hits.
  const baseUrl = 'https://agent007-ai.vercel.app'
  const checks: Check[] = []

  // ════════════════════════════════════════════════════════════════════
  // 1. LLM PROVIDERS — check which env vars are set
  // ════════════════════════════════════════════════════════════════════
  const llmProviders = [
    { id: 'openai', env: 'OPENAI_API_KEY' },
    { id: 'mistral', env: 'MISTRAL_API_KEY' },
    { id: 'groq', env: 'GROQ_API_KEY' },
    { id: 'openrouter', env: 'OPENROUTER_API_KEY' },
    { id: 'brave', env: 'BRAVE_API_KEY' },
    { id: 'gemini', env: 'GEMINI_API_KEY' },
    { id: 'z-ai', env: 'ZAI_API_KEY' },
  ]

  let activeLlmCount = 0
  for (const p of llmProviders) {
    const isSet = !!(process.env as any)[p.env]
    if (isSet) activeLlmCount++
    checks.push({
      id: `llm-${p.id}`,
      name: `LLM: ${p.id}`,
      category: 'llm',
      status: isSet ? 'pass' : 'warn',
      detail: isSet ? `${p.env} is set (${mask((process.env as any)[p.env])})` : `${p.env} not set`,
    })
  }
  checks.push({
    id: 'llm-chain',
    name: 'LLM chain summary',
    category: 'llm',
    status: activeLlmCount >= 2 ? 'pass' : activeLlmCount === 1 ? 'warn' : 'fail',
    detail: `${activeLlmCount}/7 LLM providers configured. Chain: OpenAI → Mistral → Groq → OpenRouter → Brave → Gemini → z.ai`,
  })

  // ════════════════════════════════════════════════════════════════════
  // 2. COMMUNICATION TOOLS — Telegram, Discord, ntfy
  // ════════════════════════════════════════════════════════════════════
  // Telegram
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN
  const telegramChatId = process.env.TELEGRAM_CHAT_ID
  checks.push({
    id: 'comms-telegram-token',
    name: 'Telegram bot token',
    category: 'comms',
    status: telegramToken ? 'pass' : 'fail',
    detail: telegramToken ? `TELEGRAM_BOT_TOKEN set (${mask(telegramToken)})` : 'TELEGRAM_BOT_TOKEN NOT SET',
  })
  checks.push({
    id: 'comms-telegram-chatid',
    name: 'Telegram chat ID',
    category: 'comms',
    status: telegramChatId ? 'pass' : 'fail',
    detail: telegramChatId ? `TELEGRAM_CHAT_ID set (${mask(telegramChatId)})` : 'TELEGRAM_CHAT_ID NOT SET',
  })

  // If deep test, actually verify the Telegram bot AND send a test message
  if (deep && telegramToken) {
    const tgMe = await ping(`https://api.telegram.org/bot${telegramToken}/getMe`)
    checks.push({
      id: 'comms-telegram-live',
      name: 'Telegram bot live test',
      category: 'comms',
      status: tgMe.ok && tgMe.body.includes('"ok":true') ? 'pass' : 'fail',
      detail: tgMe.ok
        ? `Bot is valid: ${tgMe.body.slice(0, 200)}`
        : `Bot verification failed: HTTP ${tgMe.status} — ${tgMe.body.slice(0, 200)}`,
    })

    // Actually send a test message if chat ID is set
    if (telegramChatId && tgMe.ok) {
      const tgSend = await ping(
        `https://api.telegram.org/bot${telegramToken}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: telegramChatId,
            text: `Agent007 Full Audit Test\n\nTime: ${new Date().toISOString()}\nThis message confirms your Telegram integration is fully working.`,
            disable_web_page_preview: true,
          }),
        },
      )
      const sendData = (() => { try { return JSON.parse(tgSend.body) } catch { return null } })()
      checks.push({
        id: 'comms-telegram-deliver',
        name: 'Telegram message delivery',
        category: 'comms',
        status: sendData?.ok === true ? 'pass' : 'fail',
        detail: sendData?.ok
          ? `Message delivered to chat ${telegramChatId} (message_id: ${sendData.result?.message_id})`
          : `Delivery failed: ${tgSend.body.slice(0, 200)}`,
      })
    }
  }

  // Discord
  const discordWebhook = process.env.DISCORD_WEBHOOK_URL
  checks.push({
    id: 'comms-discord',
    name: 'Discord webhook',
    category: 'comms',
    status: discordWebhook ? 'pass' : 'warn',
    detail: discordWebhook ? `DISCORD_WEBHOOK_URL set (${discordWebhook.slice(0, 50)}...)` : 'DISCORD_WEBHOOK_URL NOT SET (optional)',
  })

  // If deep test, actually send a Discord test message
  if (deep && discordWebhook) {
    const dcSend = await ping(discordWebhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `Agent007 Full Audit Test — Discord delivery confirmed. Time: ${new Date().toISOString()}`,
      }),
    })
    checks.push({
      id: 'comms-discord-deliver',
      name: 'Discord message delivery',
      category: 'comms',
      // Discord returns 204 No Content on success (empty body)
      status: (dcSend.ok && (dcSend.status === 204 || dcSend.status === 200)) ? 'pass' : 'fail',
      detail: dcSend.status === 204
        ? 'Message delivered to Discord channel (HTTP 204 No Content = success)'
        : `Delivery failed: HTTP ${dcSend.status} — ${dcSend.body.slice(0, 200)}`,
    })
  }

  // ntfy
  const ntfyTopic = process.env.NTFY_TOPIC || 'agent007-antonio-notifications'
  checks.push({
    id: 'comms-ntfy',
    name: 'ntfy.sh topic',
    category: 'comms',
    status: 'pass',
    detail: `NTFY_TOPIC = ${ntfyTopic} (default works without env var)`,
  })

  // ════════════════════════════════════════════════════════════════════
  // 3. MISSION ACTIVES — test the new tab's API
  // ════════════════════════════════════════════════════════════════════
  const missionList = await ping(`${baseUrl}/api/mission-active`)
  const missionData = (() => { try { return JSON.parse(missionList.body) } catch { return null } })()
  checks.push({
    id: 'mission-list',
    name: 'Mission Active list endpoint',
    category: 'mission',
    status: missionList.ok && missionData?.ok && (missionData?.count ?? 0) > 0 ? 'pass' : 'fail',
    detail: missionList.ok
      ? `Returns ${missionData?.count ?? 0} active missions`
      : `HTTP ${missionList.status}: ${missionList.body.slice(0, 200)}`,
    evidence: { httpStatus: missionList.status, bodyPreview: missionList.body.slice(0, 300) },
  })

  if (missionData?.missions?.[0]?.id) {
    const singleMission = await ping(`${baseUrl}/api/mission-active/${missionData.missions[0].id}`)
    checks.push({
      id: 'mission-single',
      name: 'Mission Active detail endpoint',
      category: 'mission',
      status: singleMission.ok ? 'pass' : 'fail',
      detail: singleMission.ok
        ? `Returns mission: ${missionData.missions[0].title.slice(0, 50)}`
        : `HTTP ${singleMission.status}: ${singleMission.body.slice(0, 200)}`,
    })
  }

  // ════════════════════════════════════════════════════════════════════
  // 4. SUBAGENTS — verify the agent registry
  // ════════════════════════════════════════════════════════════════════
  const subagents = await ping(`${baseUrl}/api/subagents`)
  const subagentData = (() => { try { return JSON.parse(subagents.body) } catch { return null } })()
  checks.push({
    id: 'agent-subagents',
    name: 'Subagent registry',
    category: 'agent',
    status: subagents.ok && Array.isArray(subagentData?.subagents) && (subagentData?.subagents?.length ?? 0) >= 18 ? 'pass' : 'fail',
    detail: subagents.ok
      ? `${subagentData?.subagents?.length ?? 0} subagents registered (target: 20)`
      : `HTTP ${subagents.status}: ${subagents.body.slice(0, 200)}`,
    evidence: { httpStatus: subagents.status, bodyPreview: subagents.body.slice(0, 300) },
  })

  // Team leaders
  const teamScout = await ping(`${baseUrl}/api/team/scout?action=pods`)
  const teamData = (() => { try { return JSON.parse(teamScout.body) } catch { return null } })()
  checks.push({
    id: 'agent-team-leaders',
    name: 'Team leader API (pods)',
    category: 'agent',
    status: teamScout.ok && (teamData?.pods?.length ?? 0) >= 7 ? 'pass' : 'warn',
    detail: teamScout.ok
      ? `${teamData?.pods?.length ?? 0} pods accessible`
      : `HTTP ${teamScout.status}: ${teamScout.body.slice(0, 200)}`,
    evidence: { httpStatus: teamScout.status, bodyPreview: teamScout.body.slice(0, 300) },
  })

  // ════════════════════════════════════════════════════════════════════
  // 5. SYSTEM HEALTH — Vercel + DB + cron
  // ════════════════════════════════════════════════════════════════════
  const health = await ping(`${baseUrl}/api/health`)
  const healthData = (() => { try { return JSON.parse(health.body) } catch { return null } })()
  checks.push({
    id: 'system-health',
    name: 'System health',
    category: 'db',
    status: health.ok && healthData?.status === 'healthy' ? 'pass' : 'fail',
    detail: health.ok
      ? `Status: ${healthData?.status} | Region: ${healthData?.region} | Uptime: ${healthData?.uptime_seconds}s`
      : `HTTP ${health.status}: ${health.body.slice(0, 200)}`,
  })

  // Mission tick (cron-able, no auth)
  const missionTick = await ping(`${baseUrl}/api/mission/tick?action=status`)
  const tickData = (() => { try { return JSON.parse(missionTick.body) } catch { return null } })()
  checks.push({
    id: 'system-mission-tick',
    name: 'Mission tick (cron)',
    category: 'agent',
    status: missionTick.ok && tickData?.ok ? 'pass' : 'fail',
    detail: missionTick.ok
      ? `Tick status: ${tickData?.preview ?? 'no preview'}`
      : `HTTP ${missionTick.status}: ${missionTick.body.slice(0, 200)}`,
  })

  // System manifest (upgrade count)
  const manifest = await ping(`${baseUrl}/api/system/manifest`)
  const manifestData = (() => { try { return JSON.parse(manifest.body) } catch { return null } })()
  checks.push({
    id: 'system-manifest',
    name: 'Upgrade manifest',
    category: 'build',
    status: manifest.ok && manifestData?.totalUpgrades >= 100 ? 'pass' : 'warn',
    detail: manifest.ok
      ? `${manifestData?.totalUpgrades ?? 0} total upgrades deployed`
      : `HTTP ${manifest.status}: ${manifest.body.slice(0, 200)}`,
  })

  // ════════════════════════════════════════════════════════════════════
  // 6. SECURITY HEADERS
  // ════════════════════════════════════════════════════════════════════
  const securityHeaders = ['x-frame-options', 'x-content-type-options', 'referrer-policy', 'strict-transport-security']
  const homeReq = await ping(baseUrl)
  const respHeaders: Record<string, string> = {}
  // ping doesn't expose headers — do a fresh fetch
  try {
    const r = await fetch(baseUrl, { signal: AbortSignal.timeout(8000) })
    r.headers.forEach((v, k) => { respHeaders[k.toLowerCase()] = v })
  } catch {}

  const foundHeaders = securityHeaders.filter((h) => respHeaders[h])
  checks.push({
    id: 'security-headers',
    name: 'Security headers',
    category: 'security',
    status: foundHeaders.length >= 3 ? 'pass' : foundHeaders.length > 0 ? 'warn' : 'fail',
    detail: `${foundHeaders.length}/${securityHeaders.length} security headers present: ${foundHeaders.join(', ') || 'none'}`,
  })

  // ════════════════════════════════════════════════════════════════════
  // 7. DEEP TESTS — ping each LLM provider directly (only with ?deep=true)
  // ════════════════════════════════════════════════════════════════════
  if (deep) {
    // OpenAI
    if (process.env.OPENAI_API_KEY) {
      const r = await ping('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      })
      checks.push({
        id: 'llm-openai-live',
        name: 'OpenAI live ping',
        category: 'llm',
        status: r.ok ? 'pass' : 'fail',
        detail: r.ok ? 'OpenAI API reachable' : `HTTP ${r.status} — ${r.body.slice(0, 150)}`,
      })
    }
    // Mistral
    if (process.env.MISTRAL_API_KEY) {
      const r = await ping('https://api.mistral.ai/v1/models', {
        headers: { Authorization: `Bearer ${process.env.MISTRAL_API_KEY}` },
      })
      checks.push({
        id: 'llm-mistral-live',
        name: 'Mistral live ping',
        category: 'llm',
        status: r.ok ? 'pass' : 'fail',
        detail: r.ok ? 'Mistral API reachable' : `HTTP ${r.status} — ${r.body.slice(0, 150)}`,
      })
    }
    // Groq
    if (process.env.GROQ_API_KEY) {
      const r = await ping('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      })
      checks.push({
        id: 'llm-groq-live',
        name: 'Groq live ping',
        category: 'llm',
        status: r.ok ? 'pass' : 'fail',
        detail: r.ok ? 'Groq API reachable' : `HTTP ${r.status} — ${r.body.slice(0, 150)}`,
      })
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ════════════════════════════════════════════════════════════════════
  const summary = {
    total: checks.length,
    pass: checks.filter((c) => c.status === 'pass').length,
    fail: checks.filter((c) => c.status === 'fail').length,
    warn: checks.filter((c) => c.status === 'warn').length,
    skip: checks.filter((c) => c.status === 'skip').length,
  }

  const byCategory: Record<string, { pass: number; fail: number; warn: number }> = {}
  for (const c of checks) {
    if (!byCategory[c.category]) byCategory[c.category] = { pass: 0, fail: 0, warn: 0 }
    byCategory[c.category][c.status === 'skip' ? 'warn' : c.status]++
  }

  return NextResponse.json({
    ok: summary.fail === 0,
    timestamp: new Date().toISOString(),
    deployedAt: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) || 'unknown',
    region: process.env.VERCEL_REGION || 'unknown',
    summary,
    byCategory,
    overallStatus: summary.fail === 0
      ? (summary.warn > 0 ? '⚠️ WORKING WITH WARNINGS' : '✅ ALL SYSTEMS NOMINAL')
      : `❌ ${summary.fail} FAILURES`,
    checks,
  })
}
