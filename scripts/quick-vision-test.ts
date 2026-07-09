import { dispatchTool } from '../src/lib/tools'

async function main() {
  const r = await dispatchTool('vision', { prompt: 'What color?' }, {
    attachments: [{ filename: 't.png', originalName: 't.png', mimeType: 'image/png', size: 70, dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==' }],
    language: 'en',
  })
  console.log('ok:', r.ok)
  console.log('result:', r.result.slice(0, 300))
}
main().catch(console.error)
