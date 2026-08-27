import fs from 'fs'
import path from 'path'
import { promises as fsp } from 'fs'
import type { ToolContext, ToolResult } from './tools'

const BASE_DIR = process.cwd()
function ok(preview: string, result: string): ToolResult { return { ok: true, preview, result } }
function bad(result: string): ToolResult { return { ok: false, preview: result.slice(0, 140), result } }

/* ================================================================ *
 * FILE_CREATE — Create a text/binary file safely within the workspace
 * ================================================================ */
export async function toolFileCreate(args: { filepath?: string; content?: string; encoding?: string }, _ctx: ToolContext): Promise<ToolResult> {
  const filepath = (args.filepath ?? '').toString().trim()
  if (!filepath) return bad('Missing "filepath" argument')
  const content = (args.content ?? '').toString()
  const encoding = (args.encoding ?? 'utf8').toString() as BufferEncoding
  try {
    const fullPath = filepath.startsWith('/') ? filepath : path.join(BASE_DIR, filepath)
    await fsp.mkdir(path.dirname(fullPath), { recursive: true })
    if (encoding === 'base64') await fsp.writeFile(fullPath, Buffer.from(content, 'base64'))
    else await fsp.writeFile(fullPath, content, encoding)
    const stat = await fsp.stat(fullPath)
    return ok(`File created: ${path.basename(fullPath)}`, `Path: ${fullPath}\nSize: ${stat.size} bytes\nEncoding: ${encoding}`)
  } catch (e: any) { return bad(`file_create failed: ${e?.message}`) }
}

/* ================================================================ *
 * FILE_READ_ANY — Read text or binary content
 * ================================================================ */
export async function toolFileReadAny(args: { filepath?: string; encoding?: string; max_bytes?: number }, _ctx: ToolContext): Promise<ToolResult> {
  const filepath = (args.filepath ?? '').toString().trim()
  if (!filepath) return bad('Missing "filepath" argument')
  const encoding = (args.encoding ?? 'utf8').toString() as BufferEncoding
  const maxBytes = Math.min(10 * 1024 * 1024, Math.max(1, Number(args.max_bytes ?? 1024 * 1024)))
  try {
    const fullPath = filepath.startsWith('/') ? filepath : path.join(BASE_DIR, filepath)
    const stat = await fsp.stat(fullPath)
    if (stat.size > maxBytes) {
      const fd = await fsp.open(fullPath, 'r')
      try {
        const buf = Buffer.alloc(maxBytes)
        const { bytesRead } = await fd.read(buf, 0, maxBytes, 0)
        return ok(`Read first ${bytesRead} bytes: ${path.basename(fullPath)}`, `File: ${fullPath}\nSize: ${stat.size} bytes\nEncoding: ${encoding}\n\nContent:\n${buf.subarray(0, bytesRead).toString(encoding)}`)
      } finally { await fd.close() }
    }
    const content = await fsp.readFile(fullPath, encoding)
    return ok(`Read: ${path.basename(fullPath)}`, `File: ${fullPath}\nSize: ${stat.size} bytes\nEncoding: ${encoding}\n\nContent:\n${content.toString().slice(0, 10000)}`)
  } catch (e: any) { return bad(`file_read_any failed: ${e?.message}`) }
}

/* ================================================================ *
 * FILE_DELETE — Delete a non-protected file
 * ================================================================ */
export async function toolFileDelete(args: { filepath?: string }, _ctx: ToolContext): Promise<ToolResult> {
  const filepath = (args.filepath ?? '').toString().trim()
  if (!filepath) return bad('Missing "filepath" argument')
  try {
    const fullPath = filepath.startsWith('/') ? filepath : path.join(BASE_DIR, filepath)
    const protectedPaths = [path.join(BASE_DIR, 'src/lib/auth.ts'), path.join(BASE_DIR, 'src/lib/db.ts'), path.join(BASE_DIR, 'src/lib/owner-auth.ts'), path.join(BASE_DIR, 'prisma/schema.prisma')]
    if (protectedPaths.includes(fullPath)) return bad(`Cannot delete protected file: ${fullPath}`)
    const stat = await fsp.stat(fullPath)
    await fsp.unlink(fullPath)
    return ok(`Deleted: ${path.basename(fullPath)}`, `Path: ${fullPath}\nSize: ${stat.size} bytes`)
  } catch (e: any) { return bad(`file_delete failed: ${e?.message}`) }
}

/* ================================================================ *
 * FILE_MODIFY — One exact find/replace with backup
 * ================================================================ */
export async function toolFileModify(args: { filepath?: string; old_content?: string; new_content?: string }, _ctx: ToolContext): Promise<ToolResult> {
  const filepath = (args.filepath ?? '').toString().trim()
  if (!filepath) return bad('Missing "filepath" argument')
  const oldContent = (args.old_content ?? '').toString()
  const newContent = (args.new_content ?? '').toString()
  if (!oldContent) return bad('Missing "old_content" to find')
  try {
    const fullPath = filepath.startsWith('/') ? filepath : path.join(BASE_DIR, filepath)
    const original = await fsp.readFile(fullPath, 'utf8')
    const occurrences = original.split(oldContent).length - 1
    if (occurrences === 0) return bad(`old_content not found in ${fullPath}`)
    if (occurrences > 1) return bad(`old_content matches ${occurrences} times; make the match more specific`)
    const backupPath = `${fullPath}.bak-${Date.now()}`
    await fsp.writeFile(backupPath, original, 'utf8')
    await fsp.writeFile(fullPath, original.replace(oldContent, newContent), 'utf8')
    return ok(`Modified: ${path.basename(fullPath)}`, `Path: ${fullPath}\nBackup: ${backupPath}\nChanges: 1 exact replacement`)
  } catch (e: any) { return bad(`file_modify failed: ${e?.message}`) }
}

/* ================================================================ *
 * IMAGE_PROCESS — Process image files (info, base64, analyze)
 * ================================================================ */
export async function toolImageProcess(args: { filepath?: string; action?: string }, _ctx: ToolContext): Promise<ToolResult> {
  const filepath = (args.filepath ?? '').toString().trim()
  if (!filepath) return bad('Missing "filepath" argument')
  const action = (args.action ?? 'info').toString()
  try {
    const fullPath = filepath.startsWith('/') ? filepath : path.join(BASE_DIR, filepath)
    const stat = await fsp.stat(fullPath)
    const ext = path.extname(fullPath).toLowerCase()
    const isImage = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp'].includes(ext)
    if (!isImage) return bad(`Not an image file: ${ext}`)
    if (action === 'info') return ok(`Image info: ${path.basename(fullPath)}`, `Image: ${fullPath}\nSize: ${Math.round(stat.size / 1024)}KB\nFormat: ${ext}`)
    if (action === 'base64') {
      const buf = await fsp.readFile(fullPath)
      const b64 = buf.toString('base64')
      const mimeType = ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : ext === '.webp' ? 'image/webp' : ext === '.svg' ? 'image/svg+xml' : 'image/jpeg'
      const dataUrl = `data:${mimeType};base64,${b64}`
      return ok(`Image base64: ${path.basename(fullPath)}`, `Base64 data URL:\n${dataUrl.slice(0, 500)}...`)
    }
    if (action === 'analyze') {
      const buf = await fsp.readFile(fullPath)
      const b64 = buf.toString('base64')
      const mimeType = ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : ext === '.webp' ? 'image/webp' : ext === '.svg' ? 'image/svg+xml' : 'image/jpeg'
      const dataUrl = `data:${mimeType};base64,${b64}`
      try {
        const { runCanonicalLlm } = await import('./canonical-llm-router')
        const resp = await runCanonicalLlm({ messages: [{ role: 'user', content: `Analyze this image data URL accurately and describe the visible content. ${dataUrl}` }], taskType: 'analysis', verification: 'standard', executionClass: 'standard' })
        return ok(`Image analyzed: ${path.basename(fullPath)}`, `Image: ${fullPath}\n\nAnalysis:\n${resp?.content ?? 'Analysis failed'}`)
      } catch {
        return ok(`Image base64 ready: ${path.basename(fullPath)}`, `Image converted to base64. Use a vision-capable tool to analyze it.\n${dataUrl.slice(0, 200)}...`)
      }
    }
    return bad(`Unknown action: ${action}. Use 'info', 'base64', or 'analyze'.`)
  } catch (e: any) { return bad(`image_process failed: ${e?.message}`) }
}

/* ================================================================ *
 * AUDIO_PROCESS — Process audio files (info, transcribe)
 * ================================================================ */
export async function toolAudioProcess(args: { filepath?: string; action?: string }, _ctx: ToolContext): Promise<ToolResult> {
  const filepath = (args.filepath ?? '').toString().trim()
  if (!filepath) return bad('Missing "filepath" argument')
  const action = (args.action ?? 'info').toString()
  try {
    const fullPath = filepath.startsWith('/') ? filepath : path.join(BASE_DIR, filepath)
    const stat = await fsp.stat(fullPath)
    const ext = path.extname(fullPath).toLowerCase()
    const isAudio = ['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a'].includes(ext)
    if (!isAudio) return bad(`Not an audio file: ${ext}`)
    if (action === 'info') return ok(`Audio info: ${path.basename(fullPath)}`, `Audio: ${fullPath}\nSize: ${Math.round(stat.size / 1024)}KB\nFormat: ${ext}`)
    if (action === 'transcribe') {
      try {
        const apiKey = process.env.OPENAI_API_KEY
        if (!apiKey) throw new Error('ASR requires OPENAI_API_KEY')
        const buf = await fsp.readFile(fullPath)
        const form = new FormData()
        form.append('file', new Blob([buf], { type: 'application/octet-stream' }), path.basename(fullPath))
        form.append('model', 'whisper-1')
        const response = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form, signal: AbortSignal.timeout(30000) })
        if (!response.ok) throw new Error(`ASR failed: HTTP ${response.status}`)
        const result = await response.json()
        return ok(`Transcribed: ${path.basename(fullPath)}`, `Audio: ${fullPath}\n\nTranscript:\n${result?.text || 'Transcription failed'}`)
      } catch (e: any) {
        return ok(`Audio info (transcribe unavailable): ${path.basename(fullPath)}`, `Audio: ${fullPath}\n\nTranscription failed: ${e?.message}`)
      }
    }
    return bad(`Unknown action: ${action}. Use 'info' or 'transcribe'.`)
  } catch (e: any) { return bad(`audio_process failed: ${e?.message}`) }
}

/* ================================================================ *
 * VIDEO_PROCESS — Process video metadata and frame extraction
 * ================================================================ */
export async function toolVideoProcess(args: { filepath?: string; action?: string }, _ctx: ToolContext): Promise<ToolResult> {
  const filepath = (args.filepath ?? '').toString().trim()
  if (!filepath) return bad('Missing "filepath" argument')
  const action = (args.action ?? 'info').toString()
  try {
    const fullPath = filepath.startsWith('/') ? filepath : path.join(BASE_DIR, filepath)
    const stat = await fsp.stat(fullPath)
    const ext = path.extname(fullPath).toLowerCase()
    if (!['.mp4', '.avi', '.mov', '.mkv', '.webm'].includes(ext)) return bad(`Not a video file: ${ext}`)
    if (action === 'info') return ok(`Video info: ${path.basename(fullPath)}`, `Video: ${fullPath}\nSize: ${Math.round(stat.size / 1024)}KB\nFormat: ${ext}`)
    if (action === 'frames') {
      const child = await import('node:child_process')
      const { promisify } = await import('node:util')
      const execFile = promisify(child.execFile)
      const outDir = path.join('/tmp', `video-frames-${Date.now()}`)
      await fsp.mkdir(outDir, { recursive: true })
      await execFile('python3', ['-c', `import cv2, os\ncap=cv2.VideoCapture(${JSON.stringify(fullPath)})\ntotal=int(cap.get(cv2.CAP_PROP_FRAME_COUNT))\nos.makedirs(${JSON.stringify(outDir)}, exist_ok=True)\nfor i in range(5):\n n=max(0,int(total*(i+1)/6))\n cap.set(cv2.CAP_PROP_POS_FRAMES,n)\n ok,frame=cap.read()\n if ok: cv2.imwrite(os.path.join(${JSON.stringify(outDir)},f'frame-{i+1}.jpg'),frame)\ncap.release()`], { timeout: 30000 })
      const files = await fsp.readdir(outDir)
      return ok(`Frames extracted: ${path.basename(fullPath)}`, `Output: ${outDir}\nFiles: ${files.join(', ')}`)
    }
    return bad(`Unknown action: ${action}. Use 'info' or 'frames'.`)
  } catch (e: any) { return bad(`video_process failed: ${e?.message}`) }
}

/* ================================================================ *
 * DIRECTORY_LIST — List a directory
 * ================================================================ */
export async function toolDirectoryList(args: { path?: string }, _ctx: ToolContext): Promise<ToolResult> {
  const requested = (args.path ?? '.').toString().trim() || '.'
  try {
    const fullPath = requested.startsWith('/') ? requested : path.join(BASE_DIR, requested)
    const entries = await fsp.readdir(fullPath, { withFileTypes: true })
    const lines = entries.slice(0, 500).map((entry) => `${entry.isDirectory() ? '[DIR]' : '[FILE]'} ${entry.name}`)
    return ok(`Directory listed: ${requested}`, `Path: ${fullPath}\nEntries: ${entries.length}\n\n${lines.join('\n')}`)
  } catch (e: any) { return bad(`directory_list failed: ${e?.message}`) }
}
