import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'node:fs'
import path from 'node:path'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { code } = body
    if (!code) return NextResponse.json({ error: 'Missing code' }, { status: 400 })
    const scriptPath = `/tmp/agent007-python-${Date.now()}.py`
    await fs.writeFile(scriptPath, code, 'utf-8')
    const { exec } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const execAsync = promisify(exec)
    try {
      const { stdout, stderr } = await execAsync(`python3 ${scriptPath}`, { timeout: 10000 })
      await fs.unlink(scriptPath).catch(() => {})
      return NextResponse.json({ ok: true, stdout, stderr })
    } catch (e: any) {
      await fs.unlink(scriptPath).catch(() => {})
      return NextResponse.json({ ok: false, error: e?.message, stdout: e?.stdout || '', stderr: e?.stderr || '' })
    }
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }) }
}
