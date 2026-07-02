import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'node:fs'
import path from 'node:path'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const limit = Math.min(100, parseInt(url.searchParams.get('limit') ?? '50'))
    const logPath = '/home/z/my-project/download/logs/agent-errors.log'
    let logs: any[] = []
    try {
      const content = await fs.readFile(logPath, 'utf-8')
      logs = content.split('\n').filter(Boolean).slice(-limit).map(l => { try { return JSON.parse(l) } catch { return { raw: l } } })
    } catch {}
    return NextResponse.json({ logs, count: logs.length })
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }) }
}
