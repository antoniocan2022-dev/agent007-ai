import { NextRequest, NextResponse } from 'next/server'
import { requireAttachmentOwner } from '@/app/api/attachments/auth'
import { presignAttachmentPart } from '@/lib/attachment-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ assetId: string }> }) {
  try {
    const user = await requireAttachmentOwner()
    const { assetId } = await params
    const body = await req.json()
    const result = await presignAttachmentPart(assetId, user.id, Number(body.partNumber))
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Attachment part signing failed.'
    const status = message === 'Unauthorized' ? 401 : 400
    return NextResponse.json({ ok: false, error: message }, { status })
  }
}
