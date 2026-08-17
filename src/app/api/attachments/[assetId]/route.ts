import { NextRequest, NextResponse } from 'next/server'
import { requireAttachmentOwner } from '@/app/api/attachments/auth'
import { abortAttachment, attachmentStatus } from '@/lib/attachment-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ assetId: string }> }) {
  try {
    const user = await requireAttachmentOwner()
    const { assetId } = await params
    return NextResponse.json({ ok: true, ...(await attachmentStatus(assetId, user.id)) })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Attachment status failed.'
    const status = message === 'Unauthorized' ? 401 : 400
    return NextResponse.json({ ok: false, error: message }, { status })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ assetId: string }> }) {
  try {
    const user = await requireAttachmentOwner()
    const { assetId } = await params
    const attachment = await abortAttachment(assetId, user.id)
    return NextResponse.json({ ok: true, attachment })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Attachment abort failed.'
    const status = message === 'Unauthorized' ? 401 : 400
    return NextResponse.json({ ok: false, error: message }, { status })
  }
}
