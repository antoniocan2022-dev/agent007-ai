import { dispatchTool, type ToolContext } from '../src/lib/tools'

let pass = 0, fail = 0
function assert(cond: boolean, label: string) { if (cond) { console.log(`✅ ${label}`); pass++ } else { console.log(`❌ ${label}`); fail++ } }
const ctx: ToolContext = { attachments: [], language: 'en' }

async function main() {
  // === 1. vision with no attachment ===
  console.log('\n--- 1. vision (no attachment) ---')
  const v1 = await dispatchTool('vision', { prompt: 'test' }, ctx)
  assert(v1.ok === false, 'vision with no attachment fails gracefully')
  assert(v1.result.includes('No attached image or video'), 'helpful error message')

  // === 2. vision with image attachment ===
  console.log('\n--- 2. vision (with image) ---')
  // Create a tiny 1x1 red pixel PNG as a data URL
  const redPixelDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='
  const ctxWithImage: ToolContext = {
    attachments: [{ filename: 'test.png', originalName: 'test.png', mimeType: 'image/png', size: 70, dataUrl: redPixelDataUrl }],
    language: 'en',
  }
  const v2 = await dispatchTool('vision', { prompt: 'What color is this image?' }, ctxWithImage)
  assert(v2.ok === true, 'vision with image succeeds')

  // === 3. vision multi-image mode ===
  console.log('\n--- 3. vision (multi-image) ---')
  const ctxMulti: ToolContext = {
    attachments: [
      { filename: 'img1.png', originalName: 'img1.png', mimeType: 'image/png', size: 70, dataUrl: redPixelDataUrl },
      { filename: 'img2.png', originalName: 'img2.png', mimeType: 'image/png', size: 70, dataUrl: redPixelDataUrl },
    ],
    language: 'en',
  }
  const v3 = await dispatchTool('vision', { prompt: 'Compare these images', analyze_all: true }, ctxMulti)
  assert(v3.ok === true, 'vision multi-image succeeds')

  // === 4. transcribe with no audio ===
  console.log('\n--- 4. transcribe (no audio) ---')
  const t1 = await dispatchTool('transcribe', { audio_index: 0 }, ctx)
  assert(t1.ok === false, 'transcribe with no audio fails gracefully')
  assert(t1.result.includes('No attached audio'), 'helpful error message')

  // === 5. document_analyze with no document ===
  console.log('\n--- 5. document_analyze (no document) ---')
  const d1 = await dispatchTool('document_analyze', { file_index: 0 }, ctx)
  assert(d1.ok === false, 'document_analyze with no document fails gracefully')
  assert(d1.result.includes('No attached document'), 'helpful error message')

  // === 6. document_analyze with text content ===
  console.log('\n--- 6. document_analyze (with text content) ---')
  const ctxWithDoc: ToolContext = {
    attachments: [{ filename: 'test.txt', originalName: 'test.txt', mimeType: 'text/plain', size: 100, textContent: 'This is a test document. It contains multiple sentences. Agent007 should be able to analyze it. The document discusses passive income strategies. Key points include diversification and automation.' }],
    language: 'en',
  }
  const d2 = await dispatchTool('document_analyze', { file_index: 0, prompt: 'Summarize this document', analysis_type: 'summary' }, ctxWithDoc)
  assert(d2.ok === true, 'document_analyze with text succeeds')
  assert(d2.result.includes('Document Analysis'), 'has analysis header')
  assert(d2.result.includes('test.txt'), 'includes filename')

  // === 7. Upload endpoint test ===
  console.log('\n--- 7. Upload endpoint ---')
  const { promises: fs } = await import('node:fs')
  await fs.writeFile('/tmp/test-upload.txt', 'Hello from Agent007 upload test!', 'utf-8')
  const uploadRes = await fetch('http://localhost:3000/api/upload', {
    method: 'POST',
    body: await (await import('node:fs')).promises.readFile('/tmp/test-upload.txt').then(buf => {
      const fd = new FormData()
      fd.append('file', new File([buf], 'test-upload.txt', { type: 'text/plain' }))
      return fd as any
    }),
  })
  const uploadData = await uploadRes.json()
  assert(uploadRes.ok, 'upload endpoint returns 200')
  assert(uploadData.originalName === 'test-upload.txt', 'returns original filename')
  assert(uploadData.textContent?.includes('Hello from Agent007'), 'extracts text content')

  // === 8. Upload image ===
  console.log('\n--- 8. Upload image ===')
  // Create a 1x1 PNG
  const pngBuf = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64')
  const imgFd = new FormData()
  imgFd.append('file', new File([pngBuf], 'test.png', { type: 'image/png' }))
  const imgRes = await fetch('http://localhost:3000/api/upload', { method: 'POST', body: imgFd as any })
  const imgData = await imgRes.json()
  assert(imgRes.ok, 'image upload returns 200')
  assert(imgData.dataUrl?.startsWith('data:image/png;base64,'), 'returns dataUrl for vision tool')
  assert(imgData.mimeType === 'image/png', 'correct mimeType')

  // === 9. vision with uploaded image dataUrl ===
  console.log('\n--- 9. vision with uploaded image ===')
  const ctxUploaded: ToolContext = {
    attachments: [{ filename: imgData.filename, originalName: 'test.png', mimeType: 'image/png', size: imgData.size, dataUrl: imgData.dataUrl }],
    language: 'en',
  }
  const v4 = await dispatchTool('vision', { prompt: 'What do you see?' }, ctxUploaded)
  assert(v4.ok === true, 'vision with uploaded image succeeds')

  console.log(`\n${'='.repeat(60)}\nRESULT: ${pass} passed, ${fail} failed\n${'='.repeat(60)}`)
  if (fail > 0) process.exit(1)
}
main().catch(e => { console.error('Crashed:', e); process.exit(1) })
