/**
 * real-integrations.ts — Stripe, WordPress, Buffer, Kraken (upgrade #54)
 */
import { ToolResult, ToolContext, okResult, badResult } from './tools'

export async function toolStripePaymentProcessor(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const action = (args?.action ?? 'create_payment').toString()
  const stripeKey = process.env.STRIPE_SECRET_KEY
  if (!stripeKey) return okResult('Stripe: SETUP REQUIRED', 'Set STRIPE_SECRET_KEY in Vercel env vars.')
  try {
    if (action === 'create_payment') {
      const amount = Math.round((args.amount || 0) * 100)
      const resp = await fetch('https://api.stripe.com/v1/payment_intents', { method: 'POST', headers: { 'Authorization': `Bearer ${stripeKey}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: `amount=${amount}&currency=usd&automatic_payment_methods[enabled]=true`, signal: AbortSignal.timeout(15000) })
      const data = await resp.json()
      if (data.id) return okResult(`Stripe: payment intent $${args.amount} — ID ${data.id}`, `Payment Intent: ${data.id}\nClient Secret: ${data.client_secret}\nStatus: ${data.status}`)
      return badResult(`Stripe error: ${data.error?.message}`)
    }
    if (action === 'list_payments') {
      const resp = await fetch('https://api.stripe.com/v1/payment_intents?limit=10', { headers: { 'Authorization': `Bearer ${stripeKey}` } })
      const data = await resp.json()
      return okResult(`Stripe: ${data.data?.length || 0} payments`, (data.data||[]).map((p:any)=>`  ${p.id}: $${(p.amount/100).toFixed(2)} — ${p.status}`).join('\n'))
    }
    return badResult(`Unknown action: ${action}`)
  } catch (e:any) { return badResult(`Stripe: ${e?.message}`) }
}

export async function toolWordPressPublisher(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const wpUrl = process.env.WORDPRESS_URL; const wpUser = process.env.WORDPRESS_USER; const wpPass = process.env.WORDPRESS_APP_PASSWORD
  if (!wpUrl || !wpUser || !wpPass) return okResult('WordPress: SETUP REQUIRED', 'Set WORDPRESS_URL, WORDPRESS_USER, WORDPRESS_APP_PASSWORD')
  try {
    const auth = Buffer.from(`${wpUser}:${wpPass}`).toString('base64')
    if (args.action === 'publish' || args.action === 'draft') {
      const resp = await fetch(`${wpUrl}/wp-json/wp/v2/posts`, { method: 'POST', headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ title: args.title||'Untitled', content: args.content||'', status: args.action==='draft'?'draft':'publish' }), signal: AbortSignal.timeout(15000) })
      const data = await resp.json()
      if (data.id) return okResult(`WordPress: ${args.action} "${(args.title||'').slice(0,40)}" — ID ${data.id}`, `Post ID: ${data.id}\nURL: ${data.link}\nStatus: ${data.status}`)
      return badResult(`WordPress: ${data.message}`)
    }
    return badResult(`Unknown action: ${args.action}`)
  } catch (e:any) { return badResult(`WordPress: ${e?.message}`) }
}

export async function toolBufferScheduler(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const token = process.env.BUFFER_ACCESS_TOKEN
  if (!token) return okResult('Buffer: SETUP REQUIRED', 'Set BUFFER_ACCESS_TOKEN')
  try {
    if (args.action === 'list_profiles') {
      const resp = await fetch(`https://api.bufferapp.com/1/profiles.json?access_token=${token}`)
      const data = await resp.json()
      return okResult(`Buffer: ${data.length} profiles`, (data||[]).map((p:any)=>`  ${p.service}: @${p.formatted_service} (${p.id})`).join('\n'))
    }
    return badResult(`Unknown action: ${args.action}`)
  } catch (e:any) { return badResult(`Buffer: ${e?.message}`) }
}

export async function toolKrakenExchange(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const action = (args?.action ?? 'ticker').toString()
  if (action === 'ticker') {
    try {
      const pair = args.pair || 'XXBTZUSD'
      const resp = await fetch(`https://api.kraken.com/0/public/Ticker?pair=${pair}`, { signal: AbortSignal.timeout(10000) })
      const data = await resp.json()
      const ticker = Object.values(data.result||{})[0] as any
      if (ticker) return okResult(`Kraken: ${pair} = $${parseFloat(ticker.c?.[0]||'0').toFixed(2)}`, `Price: $${parseFloat(ticker.c?.[0]||'0').toFixed(2)}\n24h High: $${parseFloat(ticker.h?.[0]||'0').toFixed(2)}\n24h Low: $${parseFloat(ticker.l?.[0]||'0').toFixed(2)}`)
      return badResult('Kraken: no data')
    } catch (e:any) { return badResult(`Kraken: ${e?.message}`) }
  }
  return okResult('Kraken: public ticker available. Private actions need KRAKEN_API_KEY + KRAKEN_API_SECRET', 'Set keys for private actions')
}
