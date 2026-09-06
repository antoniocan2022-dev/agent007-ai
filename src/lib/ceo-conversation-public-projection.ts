import type { AttachmentMeta } from './tools'
import { containsInternalArtifactToken } from './ceo-behavioral-policy'

export interface PublicConversationAttachment {
  filename: string
  originalName?: string
  mimeType?: string
  size?: number
  textContent?: string
}

export interface PublicConversationMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: Date
  attachments?: PublicConversationAttachment[]
}

function parseAttachments(value: string | null | undefined): PublicConversationAttachment[] | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return undefined
    return parsed.map((attachment) => {
      const item = attachment as Partial<AttachmentMeta>
      return {
        filename: typeof item.filename === 'string' ? item.filename : 'attachment',
        originalName: typeof item.originalName === 'string' ? item.originalName : undefined,
        mimeType: typeof item.mimeType === 'string' ? item.mimeType : undefined,
        size: typeof item.size === 'number' && Number.isFinite(item.size) ? item.size : undefined,
        textContent: typeof item.textContent === 'string' ? item.textContent.slice(0, 8000) : undefined,
      }
    })
  } catch {
    return undefined
  }
}

/**
 * Projects persisted conversation history for the authenticated UI.
 * Internal thought/tool rows are deliberately excluded; final user/assistant transcript
 * content is the only historical conversation surface returned to the browser. An assistant
 * row carrying a leaked internal artifact token is excluded outright rather than shown as-is --
 * the same content-level check already applied before this content re-enters model context
 * (safeConversationRows), so a poisoned historical row can't reach the human either.
 */
export function projectCeoConversationForPublic(
  rows: readonly { id: string; role: string; content: string; createdAt: Date; attachments?: string | null }[],
): PublicConversationMessage[] {
  return rows
    .filter((row): row is typeof row & { role: 'user' | 'assistant' } => row.role === 'user' || row.role === 'assistant')
    .filter((row) => row.role === 'user' || (row.content.trim() && !containsInternalArtifactToken(row.content)))
    .map((row) => ({
      id: row.id,
      role: row.role,
      content: row.content,
      createdAt: row.createdAt,
      attachments: row.role === 'user' ? parseAttachments(row.attachments) : undefined,
    }))
}
