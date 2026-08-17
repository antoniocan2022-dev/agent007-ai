import { NextRequest, NextResponse } from 'next/server'
import { requireAttachmentOwner } from '@/app/api/attachments/auth'
import { getAttachmentAsset, presignAttachmentPart } from '@/lib/attachment-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(req: NextRequest, { params }: { params: Promise<{ assetId: string }> }) {
  try {
    const user = await requireAttachmentOwner()
    const { assetId } = await params
    const body = await req.json()
    const asset = await getAttachmentAsset(assetId, user.id)
    const start = Math.max(1, Number(body.startPart ?? 1))
    const end = Math.min(asset.partCount, Number(body.endPart ?? asset.partCount))
    if (!Number.isInteger(start) || !Number.isInteger(end) || start > end || end - start + 1 > 500) throw new Error('Invalid multipart URL range.')
    const parts = []
    for (let partNumber = start; partNumber <= end; partNumber++) parts.push(await presignAttachmentPart(assetId, user.id, partNumber))
    return NextResponse.json({ ok: true, parts })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Multipart URL generation failed.'
    return NextResponse.json({ ok: false, error: message }, { status: message === 'Unauthorized' ? 401 : 400 })
  }
}
