import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { advanceV001BookProduction, startV001BookProduction } from '@/lib/venture-autonomy-control'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(req: NextRequest) {
  const session = await getServerSession()
  if (!session?.user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  try {
    if (body.action === 'start') {
      const record = await startV001BookProduction(String(body.title ?? ''), body.inputArtifactId ?? null, Array.isArray(body.chapters) ? body.chapters.map(String) : [], Number(body.pageCount ?? 25))
      return NextResponse.json({ ok: true, record })
    }
    if (body.action === 'advance') {
      const record = await advanceV001BookProduction(String(body.productionId ?? ''), body.outputArtifactId ?? null, body.ownerApproved === true)
      return NextResponse.json({ ok: true, record })
    }
    return NextResponse.json({ ok: false, error: 'action must be start or advance' }, { status: 400 })
  } catch (error: unknown) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'V001 book pipeline failed' }, { status: 400 })
  }
}
