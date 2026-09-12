// Real per-format text extraction for the knowledge-ingestion pipeline (document-ingestion.ts),
// replacing the placeholder PDF regex hack that used to live in /api/kb/route.ts and the
// "text or nothing" handling for DOCX/XLSX/PPTX (previously not extracted at all -- only their
// raw bytes were stored, honestly labelled unreadable).
//
// No new npm dependency was added: adm-zip (an existing, direct package.json dependency) opens
// DOCX/XLSX/PPTX, which are all ZIP containers of XML parts; the XML itself is read with a small
// regex-based tag-text extractor below rather than a general XML parser library, because the only
// other XML parser available in node_modules (xml2js) is a transitive dependency of jimp and not
// one this project can safely import directly -- a future jimp upgrade could drop it without
// warning. PDF extraction gains real zlib inflation of FlateDecode content streams (the compression
// nearly every real-world PDF uses), which the previous raw-byte-scan implementation never handled.
//
// None of this is a full format parser (no PDF object-graph resolution, no OOXML style/formatting
// fidelity, no formula evaluation for spreadsheets). Every extractor is explicit about that via its
// `method` and optional `warning` fields -- callers must render extraction as best-effort, exactly
// like the rest of this codebase's honesty discipline for capabilities that are real but bounded.

import AdmZip from 'adm-zip'
import { inflateSync } from 'node:zlib'

export interface ParsedDocument {
  text: string
  method: 'text' | 'pdf-besteffort' | 'docx' | 'xlsx' | 'pptx'
  warning?: string
}

const MAX_EXTRACTED_CHARS = 1_000_000

function clampText(text: string): string {
  const trimmed = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return trimmed.slice(0, MAX_EXTRACTED_CHARS)
}

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
function decodeXmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (match, entity: string) => {
    if (entity[0] === '#') {
      const codePoint = entity[1] === 'x' || entity[1] === 'X' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10)
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match
    }
    return XML_ENTITIES[entity] ?? match
  })
}

/** Extracts the text content of every occurrence of a specific tag (e.g. `w:t`, `a:t`) from raw XML. */
function extractTagRuns(xml: string, tagName: string): string[] {
  const pattern = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>|<${tagName}(?:\\s[^>]*)?\\/>`, 'g')
  const runs: string[] = []
  let match: RegExpExecArray | null
  while ((match = pattern.exec(xml))) runs.push(match[1] ? decodeXmlEntities(match[1]) : '')
  return runs
}

/**
 * DOCX text extraction: word/document.xml holds the document body as a sequence of paragraphs
 * (<w:p>), each containing text runs (<w:t>). Paragraph boundaries are approximated by splitting
 * on </w:p> -- table cell and heading structure is not preserved, only reading order.
 */
export function extractDocxText(buffer: Buffer): ParsedDocument {
  let zip: AdmZip
  try { zip = new AdmZip(buffer) } catch (error: any) { return { text: '', method: 'docx', warning: `Not a valid DOCX/ZIP container: ${error?.message ?? error}` } }
  const entry = zip.getEntry('word/document.xml')
  if (!entry) return { text: '', method: 'docx', warning: 'word/document.xml not found inside the archive -- not a standard DOCX file.' }
  const xml = entry.getData().toString('utf-8')
  const paragraphs = xml.split(/<\/w:p>/).map((paragraph) => extractTagRuns(paragraph, 'w:t').join(''))
  const text = clampText(paragraphs.filter((p) => p.trim()).join('\n'))
  return { text, method: 'docx', warning: text ? undefined : 'No text runs found in word/document.xml.' }
}

/**
 * XLSX text extraction: cell values are either inline strings, numbers, or (most commonly) an
 * index into the workbook-wide xl/sharedStrings.xml table. This resolves shared-string indices and
 * concatenates every cell's value across every worksheet, in document order -- it reconstructs the
 * text content of the workbook, not its grid layout or formulas.
 */
export function extractXlsxText(buffer: Buffer): ParsedDocument {
  let zip: AdmZip
  try { zip = new AdmZip(buffer) } catch (error: any) { return { text: '', method: 'xlsx', warning: `Not a valid XLSX/ZIP container: ${error?.message ?? error}` } }
  const sharedStringsEntry = zip.getEntry('xl/sharedStrings.xml')
  const sharedStrings: string[] = sharedStringsEntry
    ? [...sharedStringsEntry.getData().toString('utf-8').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => extractTagRuns(m[1], 't').join(''))
    : []
  const sheetEntries = zip.getEntries().filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.entryName)).sort((a, b) => a.entryName.localeCompare(b.entryName, undefined, { numeric: true }))
  if (!sheetEntries.length) return { text: '', method: 'xlsx', warning: 'No worksheet parts found inside the archive -- not a standard XLSX file.' }
  const sheetTexts: string[] = []
  for (const sheetEntry of sheetEntries) {
    const xml = sheetEntry.getData().toString('utf-8')
    const rowTexts: string[] = []
    for (const rowMatch of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cellValues: string[] = []
      for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
        const attrs = cellMatch[1]
        const inner = cellMatch[2]
        const type = attrs.match(/\bt="([^"]+)"/)?.[1]
        if (type === 's') {
          const index = Number(inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? NaN)
          if (Number.isInteger(index) && sharedStrings[index] !== undefined) cellValues.push(sharedStrings[index])
        } else if (type === 'inlineStr') {
          cellValues.push(extractTagRuns(inner, 't').join(''))
        } else {
          const value = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1]
          if (value !== undefined) cellValues.push(decodeXmlEntities(value))
        }
      }
      if (cellValues.some((v) => v.trim())) rowTexts.push(cellValues.join('\t'))
    }
    if (rowTexts.length) sheetTexts.push(rowTexts.join('\n'))
  }
  const text = clampText(sheetTexts.join('\n\n'))
  return { text, method: 'xlsx', warning: text ? undefined : 'No cell text found in any worksheet.' }
}

/**
 * PPTX text extraction: each slide is its own XML part (ppt/slides/slideN.xml) with text runs in
 * <a:t> elements; slides are joined in numeric order with a separator so downstream chunking keeps
 * one slide's content together where possible.
 */
export function extractPptxText(buffer: Buffer): ParsedDocument {
  let zip: AdmZip
  try { zip = new AdmZip(buffer) } catch (error: any) { return { text: '', method: 'pptx', warning: `Not a valid PPTX/ZIP container: ${error?.message ?? error}` } }
  const slideEntries = zip.getEntries().filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.entryName)).sort((a, b) => a.entryName.localeCompare(b.entryName, undefined, { numeric: true }))
  if (!slideEntries.length) return { text: '', method: 'pptx', warning: 'No slide parts found inside the archive -- not a standard PPTX file.' }
  const slideTexts = slideEntries.map((entry, index) => {
    const xml = entry.getData().toString('utf-8')
    const runs = extractTagRuns(xml, 'a:t').filter((run) => run.trim())
    return runs.length ? `--- Slide ${index + 1} ---\n${runs.join(' ')}` : ''
  }).filter(Boolean)
  const text = clampText(slideTexts.join('\n\n'))
  return { text, method: 'pptx', warning: text ? undefined : 'No text runs found on any slide.' }
}

/** Unescapes the PDF literal-string escapes relevant to plain text: \n \r \t \( \) \\ and octal \ddd. */
function unescapePdfString(value: string): string {
  return value.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (match, code: string) => {
    switch (code) {
      case 'n': return '\n'
      case 'r': return '\r'
      case 't': return '\t'
      case 'b': return '\b'
      case 'f': return '\f'
      case '(': return '('
      case ')': return ')'
      case '\\': return '\\'
      default: return /^[0-7]{1,3}$/.test(code) ? String.fromCharCode(parseInt(code, 8)) : match
    }
  })
}

// Matches PDF literal strings "(...)" while respecting backslash-escaped parentheses/backslashes,
// so a string containing "\)" or "\(" is not treated as closing/opening early. Does not attempt to
// balance genuinely nested, unescaped parentheses beyond what this alternation naturally consumes --
// a best-effort trade-off, not a spec-complete PDF string tokenizer.
const PDF_STRING_RE = /\(((?:\\.|[^()\\])*)\)/g

function extractTextFromContentStream(content: string): string {
  const strings: string[] = []
  let match: RegExpExecArray | null
  while ((match = PDF_STRING_RE.exec(content))) strings.push(unescapePdfString(match[1]))
  return strings.join(' ')
}

/**
 * PDF text extraction: real object streams are almost always FlateDecode-compressed, which the
 * previous /api/kb implementation never decompressed (it only ever found text in the rare
 * uncompressed stream, hence its own "very basic" comment and near-total failure rate on real
 * PDFs). This scans for stream...endstream blocks, inflates any preceded by a nearby /FlateDecode
 * filter marker, and extracts parenthesized literal strings from both the decompressed and any
 * genuinely uncompressed streams. This is still not a real PDF parser: it does not resolve the
 * object graph, does not handle CID/Type0 fonts with non-Latin encodings, and does not attempt
 * TJ-array kerning-aware reconstruction -- it is a meaningfully more capable best-effort text scrape,
 * not a guarantee of complete or perfectly-ordered text.
 */
export function extractPdfText(buffer: Buffer): ParsedDocument {
  const raw = buffer.toString('latin1')
  const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g
  const chunks: string[] = []
  let match: RegExpExecArray | null
  let sawAnyStream = false
  while ((match = streamRe.exec(raw))) {
    sawAnyStream = true
    const start = match.index
    const dictWindowStart = Math.max(0, start - 400)
    const precedingDict = raw.slice(dictWindowStart, start)
    const isFlate = /\/Filter\s*(?:\[[^\]]*\/FlateDecode[^\]]*\]|\/FlateDecode)/.test(precedingDict)
    const rawStreamBytes = Buffer.from(match[1], 'latin1')
    if (isFlate) {
      try {
        const inflated = inflateSync(rawStreamBytes).toString('latin1')
        chunks.push(extractTextFromContentStream(inflated))
        continue
      } catch {
        // Fall through to treating it as uncompressed -- some producers mislabel filters, or the
        // stream is actually an image/font binary that will simply yield no parenthesized strings.
      }
    }
    chunks.push(extractTextFromContentStream(match[1]))
  }
  // A PDF with no recognizable stream markers at all (unusual, but possible for malformed or
  // exotic files) still gets the original raw-scan fallback so this never regresses below the
  // previous implementation's floor.
  if (!sawAnyStream) chunks.push(extractTextFromContentStream(raw))
  const text = clampText(chunks.join(' ').replace(/\s+/g, ' '))
  return {
    text,
    method: 'pdf-besteffort',
    warning: text.length >= 100 ? undefined : 'Little or no text recovered -- this PDF may be scanned/image-based (no embedded text layer) or use an unsupported encoding.',
  }
}

/**
 * Dispatches to the right extractor by extension/mime type. Plain-text-like formats are handled by
 * the caller directly (a simple utf-8 decode) -- this function only covers the binary container
 * formats that need real parsing.
 */
export function extractDocumentText(buffer: Buffer, filename: string, mimeType: string): ParsedDocument | null {
  const lowerName = filename.toLowerCase()
  if (mimeType === 'application/pdf' || lowerName.endsWith('.pdf')) return extractPdfText(buffer)
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || lowerName.endsWith('.docx')) return extractDocxText(buffer)
  if (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || lowerName.endsWith('.xlsx')) return extractXlsxText(buffer)
  if (mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' || lowerName.endsWith('.pptx')) return extractPptxText(buffer)
  return null
}
