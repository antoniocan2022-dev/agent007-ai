import { NextRequest, NextResponse } from 'next/server'
import { requireAttachmentOwner } from '@/app/api/attachments/auth'
import { initiateAttachment } from '@/lib/attachment-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(req: NextRequest) {
  try {
    const user = await requireAttachmentOwner()
    const body = await req.json()
    const asset = await initiateAttachment({
      userId: user.id,
      conversationId: typeof body.conversationId === 'string' ? body.conversationId : null,
      filename: String(body.filename ?? ''),
      mimeType: typeof body.mimeType === 'string' ? body.mimeType : null,
      size: Number(body.size),
      clientRequestId: typeof body.clientRequestId === 'string' ? body.clientRequestId : null,
    })
    return NextResponse.json({ ok: true, ...asset })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Attachment initiation failed.'
    const status = message === 'Unauthorized' ? 401 : message.includes('Missing required object-storage configuration') ? 503 : 400
    return NextResponse.json({ ok: false, error: message }, { status })
  }
}
