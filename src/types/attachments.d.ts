import type { AttachmentMeta as BaseAttachmentMeta } from '@/lib/tools'

declare module '@/lib/tools' {
  interface AttachmentMeta {
    /** Canonical persistent attachment asset id. */
    attachmentId?: string
    /** Canonical storage lifecycle status. */
    status?: string
    /** Normalized attachment category. */
    kind?: string
    /** Download-only safety boundary for active content. */
    downloadOnly?: boolean
  }
}

export type UniversalAttachmentMeta = BaseAttachmentMeta
