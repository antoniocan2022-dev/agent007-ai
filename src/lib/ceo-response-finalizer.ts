import { createHash } from 'node:crypto'
import { assertUserFacingText, containsInternalArtifactToken, CEO_INTERNAL_ARTIFACT_TOKENS } from './ceo-behavioral-policy'

/**
 * Canonical ownership boundary for the final conversational string.
 * The finalizer is fail-closed: it surgically removes only known structured
 * control-plane fragments and rejects anything that still contains a control
 * plane token. It must never broadly delete legitimate prose.
 */
const STRUCTURED_TOKEN_RE = new RegExp(`\\[(${CEO_INTERNAL_ARTIFACT_TOKENS.join('|')})\\]`, 'i')

export interface CeoResponseFinalizationInput {
  content: string
  finalizationContext?: string
}

export interface FinalizedCeoResponse {
  readonly content: string
  readonly finalizationId: string
  readonly finalResponseHash: string
  readonly sanitized: boolean
  readonly rejected: boolean
}

function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

function removeStructuredArtifactFromLine(line: string): { text: string; changed: boolean } {
  const match = STRUCTURED_TOKEN_RE.exec(line)
  if (!match || match.index < 0) return { text: line, changed: false }

  const start = match.index
  let cursor = start + match[0].length
  while (cursor < line.length && /\s/.test(line[cursor] ?? '')) cursor += 1

  if (line[cursor] === '{') {
    let depth = 0
    let inString = false
    let escaped = false
    for (; cursor < line.length; cursor += 1) {
      const char = line[cursor]
      if (inString) {
        if (escaped) escaped = false
        else if (char === '\\') escaped = true
        else if (char === '"') inString = false
        continue
      }
      if (char === '"') {
        inString = true
        continue
      }
      if (char === '{') depth += 1
      else if (char === '}') {
        depth -= 1
        if (depth === 0) {
          cursor += 1
          break
        }
      }
    }
  } else {
    while (cursor < line.length && !/\s/.test(line[cursor] ?? '')) cursor += 1
  }

  const cleaned = `${line.slice(0, start)} ${line.slice(cursor)}`.replace(/\s{2,}/g, ' ').trim()
  return { text: cleaned, changed: true }
}

function sanitizeControlPlaneFragments(content: string): { content: string; changed: boolean } {
  let changed = false
  const lines = content.split(/\r?\n/).map((initialLine) => {
    let line = initialLine
    // Multiple control-plane fragments can occur on the same line. Keep the
    // iteration bounded so malformed input can never create an unbounded loop.
    for (let iteration = 0; iteration < 32; iteration += 1) {
      const result = removeStructuredArtifactFromLine(line)
      if (!result.changed) break
      changed = true
      line = result.text
    }
    return line
  })
  return {
    content: lines.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    changed,
  }
}

export function finalizeCeoResponse(input: CeoResponseFinalizationInput): FinalizedCeoResponse {
  const original = input.content.trim()
  if (!original) {
    const safe = 'Agent007 could not produce a usable response.'
    const hash = hashContent(safe)
    return Object.freeze({ content: safe, finalizationId: `ceo-final-${hash.slice(0, 16)}`, finalResponseHash: hash, sanitized: false, rejected: true })
  }

  const sanitized = sanitizeControlPlaneFragments(original)
  const checked = assertUserFacingText(sanitized.content)
  const rejected = !checked || containsInternalArtifactToken(checked)
  const finalContent = rejected
    ? 'I couldn’t complete the user-facing response cleanly. Internal execution details were withheld.'
    : checked
  const finalResponseHash = hashContent(finalContent)
  return Object.freeze({
    content: finalContent,
    finalizationId: `ceo-final-${finalResponseHash.slice(0, 16)}`,
    finalResponseHash,
    sanitized: sanitized.changed,
    rejected,
  })
}

export function assertFinalResponseInvariant(response: FinalizedCeoResponse): void {
  const checked = assertUserFacingText(response.content)
  if (!checked || containsInternalArtifactToken(response.content)) throw new Error('CEO_FINAL_RESPONSE_INVARIANT_FAILED')
  if (hashContent(response.content) !== response.finalResponseHash) throw new Error('CEO_FINAL_RESPONSE_HASH_MISMATCH')
  if (response.finalizationId !== `ceo-final-${response.finalResponseHash.slice(0, 16)}`) throw new Error('CEO_FINAL_RESPONSE_ID_MISMATCH')
}

export function buildFinalizationProvenance(response: FinalizedCeoResponse, context?: string): {
  finalizationId: string
  finalResponseHash: string
  finalContentLength: number
  sanitized: boolean
  rejected: boolean
  context: string | undefined
} {
  return {
    finalizationId: response.finalizationId,
    finalResponseHash: response.finalResponseHash,
    finalContentLength: response.content.length,
    sanitized: response.sanitized,
    rejected: response.rejected,
    context: context?.trim() || undefined,
  }
}
