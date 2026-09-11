/**
 * real-integrations-v2.ts — Resend, Affiliate, DataForSEO, PayPal, Analytics (upgrade #56)
 */
import { ToolResult, ToolContext, okResult, badResult } from './tools'
import { db } from './db'

export async function toolResendEmailAutomation(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return okResult('Resend: SETUP REQUIRED', 'Set RESEND_API_KEY')
  try {
    if (args.action === 'send' || !args.action) {
      const to = args.to || args.email; const subject = args.subject || 'Agent007'; const html = args.html || args.text || '<p>Test</p>'
      const resp = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: process.env.RESEND_FROM || 'Agent007 <noreply@resend.dev>', to: Array.isArray(to)?to:[to], subject, html }), signal: AbortSignal.timeout(15000) })
      const data = await resp.json()
      if (data.id) return okResult(`Resend: email sent to ${to} — ID ${data.id}`, `To: ${to}\nSubject: ${subject}\nID: ${data.id}`)
      return badResult(`Resend: ${JSON.stringify(data).slice(0,200)}`)
    }
    if (args.action === 'get_emails') {
      const resp = await fetch('https://api.resend.com/emails', { headers: { 'Authorization': `Bearer ${apiKey}` } })
      const data = await resp.json()
      return okResult(`Resend: ${data.data?.length||0} emails`, (data.data||[]).slice(0,10).map((e:any)=>`  ${e.id}: ${e.to} — ${e.subject}`).join('\n'))
    }
    return badResult(`Unknown action: ${args.action}`)
  } catch (e:any) { return badResult(`Resend: ${e?.message}`) }
}

// Live-audit finding: every action here previously returned a canned success string with no durable
// record behind it -- 'stats' in particular returned a hardcoded program count and monthly-revenue
// figure regardless of actual state, a fabricated business number a CEO or subagent could present to
// the owner as fact.
// track_conversion now persists a real IncomeEntry (source-tagged 'affiliate:<source>', reusing the
// existing income model rather than inventing a parallel one); stats aggregates real persisted rows and
// honestly reports zero activity instead of a fixed success narrative when none exists;
// automate_payout delegates to the real PayPal payout implementation below instead of claiming a
// payout that never happens. track_click has no durable ledger to write to (no per-click model exists
// and adding one is a real feature, not this honesty fix) -- its response no longer implies a record
// was kept beyond acknowledging the input.
export async function toolAffiliateTracker(args: any, ctx: ToolContext): Promise<ToolResult> {
  const action = (args?.action ?? 'stats').toString()
  if (action === 'track_click') return okResult('Affiliate: click noted (not persisted -- no durable click ledger yet)', `Source: ${args.source || 'unknown'}\nLink: ${args.link || ''}`)
  if (action === 'track_conversion') {
    const amount = Number(args.amount) || 0
    const commission = Math.round(amount * 0.3 * 100) / 100
    const source = String(args.source || 'unknown')
    try {
      await db.incomeEntry.create({ data: { amount: commission, source: `affiliate:${source}`, notes: `Affiliate conversion -- sale $${amount.toFixed(2)}, 30% commission` } })
      return okResult(`Affiliate: conversion recorded -- $${amount.toFixed(2)} sale, $${commission.toFixed(2)} commission`, `Source: ${source}\nSale: $${amount.toFixed(2)}\nCommission: $${commission.toFixed(2)}`)
    } catch (e: any) { return badResult(`Affiliate: failed to record conversion -- ${e?.message}`) }
  }
  if (action === 'stats') {
    try {
      const since = new Date(Date.now() - 30 * 24 * 3600 * 1000)
      const rows = await db.incomeEntry.findMany({ where: { source: { startsWith: 'affiliate:' }, date: { gte: since } } })
      if (!rows.length) return okResult('Affiliate: no conversions recorded in the last 30 days', 'No affiliate activity tracked yet. Use action=track_conversion to record a real sale.')
      const programs = new Set(rows.map((r) => r.source)).size
      const total = rows.reduce((sum, r) => sum + r.amount, 0)
      return okResult(`Affiliate: ${programs} program(s), $${total.toFixed(2)} commission (30d), ${rows.length} conversion(s)`, `${programs} programs tracked, $${total.toFixed(2)} commission in the last 30 days, ${rows.length} conversions`)
    } catch (e: any) { return badResult(`Affiliate: stats query failed -- ${e?.message}`) }
  }
  if (action === 'automate_payout') {
    const recipient = args.affiliate || args.email
    if (!recipient) return badResult('Affiliate payout: recipient email required (args.affiliate or args.email)')
    return toolPayPalAPI({ action: 'payout', amount: args.amount, currency: args.currency, recipient, note: `Affiliate payout to ${recipient}` }, ctx)
  }
  return badResult(`Unknown action: ${action}`)
}

export async function toolDataForSEO(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const email = process.env.DATAFORSEO_EMAIL; const password = process.env.DATAFORSEO_PASSWORD
  if (!email || !password) return okResult('DataForSEO: SETUP REQUIRED', 'Set DATAFORSEO_EMAIL + DATAFORSEO_PASSWORD')
  const action = (args?.action ?? 'keywords').toString()
  try {
    const auth = Buffer.from(`${email}:${password}`).toString('base64')
    if (action === 'keywords') {
      const resp = await fetch('https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live', { method: 'POST', headers: { 'Authorization': `Basic ${auth}` }, body: JSON.stringify([{ keyword: args.keyword||'AI', location_code: 2840, language_code: 'en' }]), signal: AbortSignal.timeout(15000) })
      const data = await resp.json()
      const r = data.tasks?.[0]?.result?.[0]
      if (r) return okResult(`DataForSEO: "${args.keyword}" — ${r.search_volume||0} searches/mo ✅`, `Keyword: ${args.keyword}\nVolume: ${r.search_volume||0}\nCPC: $${r.cpc?.toFixed(2)||'N/A'}`)
      return okResult('DataForSEO: no data', 'No volume data returned')
    }
    return badResult(`Unknown action: ${action}`)
  } catch (e:any) { return badResult(`DataForSEO: ${e?.message}`) }
}

// Live-audit finding: TOOL_REGISTRY labels this 'PayPal REST API (REAL -- balance, orders, payouts)',
// but it never called PayPal at all -- it only confirmed env vars were set and returned a canned
// "ready" message naming actions (balance, create_order, payout, list_transactions) that didn't exist
// anywhere in the codebase. This is now a real implementation against PayPal's actual REST APIs:
// OAuth2 client-credentials token exchange, the Reporting Balances API, Checkout Orders v2, the
// Payouts API, and the Reporting Transactions API. Defaults to the PayPal sandbox base URL unless
// PAYPAL_ENV=live is explicitly set, so a misconfigured deployment fails safely toward test money,
// not real money.
async function getPayPalAccessToken(clientId: string, clientSecret: string, base: string): Promise<string> {
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const resp = await fetch(`${base}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(10000),
  })
  const data = await resp.json()
  if (!resp.ok || !data.access_token) throw new Error(`PayPal auth failed: ${data.error_description || data.error || resp.status}`)
  return data.access_token
}

export async function toolPayPalAPI(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const clientId = process.env.PAYPAL_CLIENT_ID; const clientSecret = process.env.PAYPAL_CLIENT_SECRET
  if (!clientId || !clientSecret) return okResult('PayPal: SETUP REQUIRED', 'Set PAYPAL_CLIENT_ID + PAYPAL_CLIENT_SECRET')
  const base = process.env.PAYPAL_ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com'
  const action = (args?.action ?? 'balance').toString()
  try {
    const token = await getPayPalAccessToken(clientId, clientSecret, base)
    if (action === 'balance') {
      const resp = await fetch(`${base}/v1/reporting/balances`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) })
      const data = await resp.json()
      if (!resp.ok) return badResult(`PayPal balance: ${data.message || resp.status}`)
      const balances = (data.balances || []).map((b: any) => `${b.currency}: ${b.total_balance?.value ?? '0'}`).join(', ')
      return okResult(`PayPal balance: ${balances || 'no balances returned'}`, JSON.stringify(data.balances ?? [], null, 2))
    }
    if (action === 'create_order') {
      const amount = String(args.amount ?? '0.00'); const currency = args.currency || 'USD'
      const resp = await fetch(`${base}/v2/checkout/orders`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent: 'CAPTURE', purchase_units: [{ amount: { currency_code: currency, value: amount } }] }),
        signal: AbortSignal.timeout(10000),
      })
      const data = await resp.json()
      if (!resp.ok) return badResult(`PayPal create_order: ${data.message || resp.status}`)
      const approveLink = (data.links || []).find((l: any) => l.rel === 'approve')?.href
      return okResult(`PayPal order created: ${data.id} (${data.status})`, `Order ID: ${data.id}\nStatus: ${data.status}${approveLink ? `\nApprove: ${approveLink}` : ''}`)
    }
    if (action === 'payout') {
      const amount = String(args.amount ?? '0.00'); const currency = args.currency || 'USD'; const recipient = args.recipient || args.email
      if (!recipient) return badResult('PayPal payout: recipient email required (args.recipient or args.email)')
      const resp = await fetch(`${base}/v1/payments/payouts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sender_batch_header: { sender_batch_id: `agent007-${Date.now()}`, email_subject: 'You have a payout' }, items: [{ recipient_type: 'EMAIL', amount: { value: amount, currency }, receiver: recipient, note: args.note || 'Agent007 payout' }] }),
        signal: AbortSignal.timeout(10000),
      })
      const data = await resp.json()
      if (!resp.ok) return badResult(`PayPal payout: ${data.message || resp.status}`)
      return okResult(`PayPal payout queued: batch ${data.batch_header?.payout_batch_id} (${data.batch_header?.batch_status})`, JSON.stringify(data.batch_header ?? {}, null, 2))
    }
    if (action === 'list_transactions') {
      const end = new Date(); const start = new Date(end.getTime() - 30 * 24 * 3600 * 1000)
      const resp = await fetch(`${base}/v1/reporting/transactions?start_date=${start.toISOString()}&end_date=${end.toISOString()}&fields=transaction_info`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) })
      const data = await resp.json()
      if (!resp.ok) return badResult(`PayPal list_transactions: ${data.message || resp.status}`)
      const txns = data.transaction_details ?? []
      return okResult(`PayPal: ${txns.length} transaction(s) in the last 30 days`, txns.slice(0, 10).map((t: any) => `  ${t.transaction_info?.transaction_id}: ${t.transaction_info?.transaction_amount?.value} ${t.transaction_info?.transaction_amount?.currency_code}`).join('\n'))
    }
    return badResult(`Unknown action: ${action}. Use action=balance, create_order, payout, or list_transactions.`)
  } catch (e: any) { return badResult(`PayPal: ${e?.message}`) }
}

export async function toolWebsiteAnalytics(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const action = (args?.action ?? 'traffic').toString()
  const site = process.env.PLAUSIBLE_DOMAIN || 'agent007-ai.vercel.app'
  const key = process.env.PLAUSIBLE_API_KEY
  try {
    const headers: any = {}; if (key) headers['Authorization'] = `Bearer ${key}`
    if (action === 'traffic') {
      const resp = await fetch(`https://plausible.io/api/v1/stats/aggregate?site_id=${site}&period=30d&metrics=visitors,pageviews,bounce_rate`, { headers, signal: AbortSignal.timeout(10000) })
      const data = await resp.json()
      if (data.results) { const r = data.results; return okResult(`Analytics: ${r.visitors?.value||0} visitors, ${r.pageviews?.value||0} pageviews ✅`, `Visitors: ${r.visitors?.value||0}\nPageviews: ${r.pageviews?.value||0}\nBounce: ${r.bounce_rate?.value?.toFixed(1)||'N/A'}%`) }
      return okResult('Analytics: setup required', 'Set PLAUSIBLE_API_KEY for real data')
    }
    return badResult(`Unknown action: ${action}`)
  } catch { return okResult('Analytics: setup required', 'Set PLAUSIBLE_API_KEY') }
}
