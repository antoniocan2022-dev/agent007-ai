import { NextRequest, NextResponse } from 'next/server'
import { requireAttachmentOwner } from '@/app/api/attachments/auth'
import { completeAttachment } from '@/lib/attachment-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest, { params }: { params: Promise<{ assetId: string }> }) {
  try {
    const user = await requireAttachmentOwner()
    const { assetId } = await params
    const body = await req.json()
    if (!Array.isArray(body.parts)) throw new Error('Multipart parts are required.')
    const parts = body.parts.map((part: any) => ({ partNumber: Number(part.partNumber), etag: String(part.etag ?? ''), size: part.size == null ? undefined : Number(part.size) }))
    const record = await completeAttachment(assetId, user.id, parts)
    return NextResponse.json({
      ok: true,
      attachment: {
        attachmentId: record.id,
        filename: record.safeName,
        originalName: record.originalName,
        mimeType: record.mimeType,
        size: record.size,
        status: record.status,
        kind: record.kind,
        downloadOnly: record.downloadOnly,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Attachment completion failed.'
    const status = message === 'Unauthorized' ? 401 : 400
    return NextResponse.json({ ok: false, error: message }, { status })
  }
}
