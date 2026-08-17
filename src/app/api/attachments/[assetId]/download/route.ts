import { NextRequest, NextResponse } from 'next/server'
import { requireAttachmentOwner } from '@/app/api/attachments/auth'
import { getAttachmentAsset, signedAttachmentDownload } from '@/lib/attachment-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ assetId: string }> }) {
  try {
    const user = await requireAttachmentOwner()
    const { assetId } = await params
    const asset = await getAttachmentAsset(assetId, user.id)
    const url = await signedAttachmentDownload(assetId, user.id)
    const disposition = asset.downloadOnly ? 'attachment' : 'inline'
    const response = NextResponse.redirect(url, 302)
    response.headers.set('Content-Disposition', `${disposition}; filename="${asset.safeName.replace(/\"/g, '')}"`)
    response.headers.set('Cache-Control', 'private, no-store')
    return response
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Attachment download failed.'
    return NextResponse.json({ ok: false, error: message }, { status: message === 'Unauthorized' ? 401 : 400 })
  }
}
