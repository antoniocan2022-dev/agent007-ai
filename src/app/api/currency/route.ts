import { NextRequest, NextResponse } from 'next/server'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const from = (url.searchParams.get('from') || 'USD').toUpperCase()
  const to = (url.searchParams.get('to') || 'EUR').toUpperCase()
  const amount = parseFloat(url.searchParams.get('amount') || '1')
  try {
    const res = await fetch(`https://api.exchangerate-api.com/v4/latest/${from}`, { signal: AbortSignal.timeout(10000) })
    const data = await res.json()
    const rate = data.rates?.[to] || 1
    return NextResponse.json({ from, to, amount, rate, converted: (amount * rate).toFixed(2), date: data.date })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Currency API failed' }, { status: 500 })
  }
}
