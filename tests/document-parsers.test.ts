import { describe, expect, test } from 'bun:test'
import { deflateSync } from 'node:zlib'
import AdmZip from 'adm-zip'
import { extractDocumentText, extractDocxText, extractPdfText, extractPptxText, extractXlsxText } from '@/lib/document-parsers'

describe('extractPdfText', () => {
  test('extracts text from an uncompressed content stream (the previous implementation\'s floor)', () => {
    const pdf = `%PDF-1.4\n1 0 obj\n<< /Length 40 >>\nstream\nBT /F1 12 Tf (Hello uncompressed world) Tj ET\nendstream\nendobj\n%%EOF`
    const result = extractPdfText(Buffer.from(pdf, 'latin1'))
    expect(result.method).toBe('pdf-besteffort')
    expect(result.text).toContain('Hello uncompressed world')
  })

  test('inflates a FlateDecode-compressed content stream and extracts its text (the real improvement over a raw-byte scan)', () => {
    const contentStream = 'BT /F1 12 Tf (Hello compressed world) Tj ET'
    const compressed = deflateSync(Buffer.from(contentStream, 'latin1'))
    const pdf = Buffer.concat([
      Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'),
      compressed,
      Buffer.from('\nendstream\nendobj\n%%EOF', 'latin1'),
    ])
    const result = extractPdfText(pdf)
    expect(result.text).toContain('Hello compressed world')
  })

  test('correctly unescapes backslash-escaped parentheses inside a PDF literal string', () => {
    const pdf = `%PDF-1.4\nstream\n(Section 3\\(a\\) applies) Tj\nendstream`
    const result = extractPdfText(Buffer.from(pdf, 'latin1'))
    expect(result.text).toContain('Section 3(a) applies')
  })

  test('returns a warning (not a crash) when almost no text is recoverable, e.g. a scanned/image-only PDF', () => {
    const pdf = `%PDF-1.4\n1 0 obj\n<< /Length 5 >>\nstream\n\x00\x01\x02\x03\x04\nendstream\nendobj\n%%EOF`
    const result = extractPdfText(Buffer.from(pdf, 'latin1'))
    expect(result.warning).toBeDefined()
  })
})

describe('extractDocxText', () => {
  function buildDocx(paragraphs: string[]): Buffer {
    const runs = paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join('')
    const xml = `<?xml version="1.0"?><w:document xmlns:w="ns"><w:body>${runs}</w:body></w:document>`
    const zip = new AdmZip()
    zip.addFile('word/document.xml', Buffer.from(xml, 'utf-8'))
    return zip.toBuffer()
  }

  test('extracts paragraph text runs in order, one paragraph per line', () => {
    const result = extractDocxText(buildDocx(['First paragraph.', 'Second paragraph.']))
    expect(result.method).toBe('docx')
    expect(result.text).toBe('First paragraph.\nSecond paragraph.')
  })

  test('decodes XML entities within text runs', () => {
    const result = extractDocxText(buildDocx(['Tom &amp; Jerry &lt;3']))
    expect(result.text).toContain('Tom & Jerry <3')
  })

  test('reports a clear warning for a non-DOCX zip rather than throwing', () => {
    const zip = new AdmZip()
    zip.addFile('readme.txt', Buffer.from('not a docx', 'utf-8'))
    const result = extractDocxText(zip.toBuffer())
    expect(result.text).toBe('')
    expect(result.warning).toContain('not a standard DOCX')
  })

  test('reports a clear warning for a non-ZIP buffer rather than throwing', () => {
    const result = extractDocxText(Buffer.from('this is not a zip file at all', 'utf-8'))
    expect(result.text).toBe('')
    expect(result.warning).toBeDefined()
  })
})

describe('extractXlsxText', () => {
  function buildXlsx(): Buffer {
    const sharedStrings = `<?xml version="1.0"?><sst><si><t>Revenue</t></si><si><t>Expenses</t></si></sst>`
    const sheet = `<?xml version="1.0"?><worksheet><sheetData>
      <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>1000</v></c></row>
      <row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>400</v></c></row>
    </sheetData></worksheet>`
    const zip = new AdmZip()
    zip.addFile('xl/sharedStrings.xml', Buffer.from(sharedStrings, 'utf-8'))
    zip.addFile('xl/worksheets/sheet1.xml', Buffer.from(sheet, 'utf-8'))
    return zip.toBuffer()
  }

  test('resolves shared-string cell references and includes numeric cell values', () => {
    const result = extractXlsxText(buildXlsx())
    expect(result.method).toBe('xlsx')
    expect(result.text).toContain('Revenue')
    expect(result.text).toContain('1000')
    expect(result.text).toContain('Expenses')
    expect(result.text).toContain('400')
  })

  test('reports a clear warning when no worksheet parts exist', () => {
    const zip = new AdmZip()
    zip.addFile('readme.txt', Buffer.from('not an xlsx', 'utf-8'))
    const result = extractXlsxText(zip.toBuffer())
    expect(result.warning).toContain('not a standard XLSX')
  })
})

describe('extractPptxText', () => {
  function buildPptx(slides: string[]): Buffer {
    const zip = new AdmZip()
    slides.forEach((text, index) => {
      const xml = `<?xml version="1.0"?><p:sld xmlns:a="ns"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
      zip.addFile(`ppt/slides/slide${index + 1}.xml`, Buffer.from(xml, 'utf-8'))
    })
    return zip.toBuffer()
  }

  test('extracts text runs per slide, in slide order, with a slide separator', () => {
    const result = extractPptxText(buildPptx(['Welcome', 'Q3 Results']))
    expect(result.method).toBe('pptx')
    const welcomeIndex = result.text.indexOf('Welcome')
    const resultsIndex = result.text.indexOf('Q3 Results')
    expect(welcomeIndex).toBeGreaterThanOrEqual(0)
    expect(resultsIndex).toBeGreaterThan(welcomeIndex)
    expect(result.text).toContain('Slide 1')
    expect(result.text).toContain('Slide 2')
  })
})

describe('extractDocumentText dispatch', () => {
  test('dispatches by mime type', () => {
    const zip = new AdmZip()
    zip.addFile('word/document.xml', Buffer.from('<w:document><w:body><w:p><w:r><w:t>hi</w:t></w:r></w:p></w:body></w:document>', 'utf-8'))
    const result = extractDocumentText(zip.toBuffer(), 'upload.bin', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    expect(result?.method).toBe('docx')
  })

  test('dispatches by file extension when mime type is generic/absent', () => {
    const zip = new AdmZip()
    zip.addFile('word/document.xml', Buffer.from('<w:document><w:body><w:p><w:r><w:t>hi</w:t></w:r></w:p></w:body></w:document>', 'utf-8'))
    const result = extractDocumentText(zip.toBuffer(), 'report.docx', 'application/octet-stream')
    expect(result?.method).toBe('docx')
  })

  test('returns null for a format this module does not handle', () => {
    const result = extractDocumentText(Buffer.from('hello'), 'photo.png', 'image/png')
    expect(result).toBeNull()
  })
})
