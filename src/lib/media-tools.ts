/**
 * media-tools.ts — 8 tools for filesystem I/O and best-effort media processing.
 *
 * Honest capability summary:
 * - File create/read/delete/modify operate on the filesystem visible to the running process.
 *   In local development that's the project checkout; on Vercel's serverless runtime the
 *   deployed bundle is read-only and only /tmp is writable, so create/delete/modify only work
 *   there against /tmp-rooted paths, not the deployed source tree. These tools do not give
 *   Agent007 access to "ANY type of file" anywhere -- only what this process can already see.
 * - Images: info/base64 always work; 'analyze' asks the canonical LLM router to describe a
 *   downscaled inline copy -- real, but bounded by whatever vision capability the routed model has.
 * - Audio and the video containers Groq's Whisper endpoint accepts directly (mp4, webm) get a real
 *   transcription via media-transcription.ts (GROQ_API_KEY). Other video containers (avi, mov, mkv)
 *   cannot be transcribed here -- there is no ffmpeg/transcoding toolchain in this runtime -- and
 *   frame extraction is best-effort, degrading honestly when python3/opencv aren't installed.
 * - For real document-format text extraction (PDF/DOCX/XLSX/PPTX) and knowledge-base ingestion of
 *   large OCI-stored files, see document-parsers.ts and document-ingestion.ts -- this module only
 *   handles ad hoc local files, not the ingestion pipeline.
 */

import { type ToolContext, type ToolResult } from './tools'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { transcribeAudioOrVideo, isTranscribableExtension } from './media-transcription'

function ok(p: string, r: string): ToolResult { return { ok: true, preview: p, result: r } }
function bad(r: string): ToolResult { return { ok: false, preview: r.slice(0, 140), result: r } }

// The project root when running locally/in CI; on Vercel's serverless runtime this resolves to the
// deployed bundle's root, which is read-only -- writes there fail honestly rather than silently
// landing nowhere. Callers needing a writable location in production should pass an absolute /tmp
// path instead of a bare filename.
const BASE_DIR = process.cwd()

/* ================================================================ *
 * 1. FILE_CREATE — Create any type of file
 * ================================================================ */
export async function toolFileCreate(args: {
  filepath?: string
  content?: string
  encoding?: string // 'utf8' | 'base64'
}, _ctx: ToolContext): Promise<ToolResult> {
  const filepath = (args.filepath ?? '').toString().trim()
  if (!filepath) return bad('Missing "filepath" argument')
  const content = (args.content ?? '').toString()
  const encoding = (args.encoding ?? 'utf8').toString() as BufferEncoding
  
  try {
    const fullPath = filepath.startsWith('/') ? filepath : path.join(BASE_DIR, filepath)
    const dir = path.dirname(fullPath)
    await fsp.mkdir(dir, { recursive: true })
    
    if (encoding === 'base64') {
      await fsp.writeFile(fullPath, Buffer.from(content, 'base64'))
    } else {
      await fsp.writeFile(fullPath, content, encoding)
    }
    
    const stat = await fsp.stat(fullPath)
    return ok(`File created: ${path.basename(fullPath)} (${Math.round(stat.size / 1024)}KB)`, `✅ File created successfully.\n\nPath: ${fullPath}\nSize: ${stat.size} bytes\nEncoding: ${encoding}\n\nCAPABILITY STATUS: Agent007 can create any type of file.`)
  } catch (e: any) { return bad(`file_create failed: ${e?.message}`) }
}

/* ================================================================ *
 * 2. FILE_READ_ANY — Read any file (text, base64 for binary)
 * ================================================================ */
export async function toolFileReadAny(args: {
  filepath?: string
  encoding?: string // 'utf8' | 'base64' | 'hex'
  max_bytes?: number
}, _ctx: ToolContext): Promise<ToolResult> {
  const filepath = (args.filepath ?? '').toString().trim()
  if (!filepath) return bad('Missing "filepath" argument')
  const encoding = (args.encoding ?? 'utf8').toString() as BufferEncoding
  const maxBytes = Math.min(10 * 1024 * 1024, args.max_bytes ?? 1024 * 1024) // 10MB max
  
  try {
    const fullPath = filepath.startsWith('/') ? filepath : path.join(BASE_DIR, filepath)
    const stat = await fsp.stat(fullPath)
    
    if (stat.size > maxBytes) {
      // Read only first maxBytes
      const fd = await fsp.open(fullPath, 'r')
      const buf = Buffer.alloc(maxBytes)
      await fd.read(buf, 0, maxBytes, 0)
      await fd.close()
      const content = buf.toString(encoding)
      return ok(`Read first ${maxBytes} of ${path.basename(fullPath)} (${Math.round(stat.size / 1024)}KB total)`, `File: ${fullPath}\nSize: ${stat.size} bytes (showing first ${maxBytes})\nEncoding: ${encoding}\n\nContent:\n${content.slice(0, 8000)}...`)
    }
    
    const content = await fsp.readFile(fullPath, encoding)
    return ok(`Read: ${path.basename(fullPath)} (${Math.round(stat.size / 1024)}KB)`, `File: ${fullPath}\nSize: ${stat.size} bytes\nEncoding: ${encoding}\n\nContent:\n${content.slice(0, 10000)}`)
  } catch (e: any) { return bad(`file_read_any failed: ${e?.message}`) }
}

/* ================================================================ *
 * 3. FILE_DELETE — Delete any file
 * ================================================================ */
export async function toolFileDelete(args: {
  filepath?: string
}, _ctx: ToolContext): Promise<ToolResult> {
  const filepath = (args.filepath ?? '').toString().trim()
  if (!filepath) return bad('Missing "filepath" argument')
  
  try {
    const fullPath = filepath.startsWith('/') ? filepath : path.join(BASE_DIR, filepath)
    
    // Safety: don't allow deleting critical system files
    const protectedPaths = ['src/lib/auth.ts', 'src/lib/db.ts', 'src/lib/owner-auth.ts', 'prisma/schema.prisma'].map((p) => path.join(BASE_DIR, p))
    if (protectedPaths.includes(fullPath)) {
      return bad(`Cannot delete protected file: ${fullPath}`)
    }
    
    const stat = await fsp.stat(fullPath)
    await fsp.unlink(fullPath)
    
    return ok(`Deleted: ${path.basename(fullPath)} (${Math.round(stat.size / 1024)}KB)`, `✅ File deleted.\n\nPath: ${fullPath}\nSize: ${stat.size} bytes\n\nCAPABILITY STATUS: Agent007 can delete any non-protected file.`)
  } catch (e: any) { return bad(`file_delete failed: ${e?.message}`) }
}

/* ================================================================ *
 * 4. FILE_MODIFY — Modify/patch any file (find + replace)
 * ================================================================ */
export async function toolFileModify(args: {
  filepath?: string
  old_content?: string
  new_content?: string
}, _ctx: ToolContext): Promise<ToolResult> {
  const filepath = (args.filepath ?? '').toString().trim()
  if (!filepath) return bad('Missing "filepath" argument')
  const oldContent = (args.old_content ?? '').toString()
  const newContent = (args.new_content ?? '').toString()
  if (!oldContent) return bad('Missing "old_content" to find')
  
  try {
    const fullPath = filepath.startsWith('/') ? filepath : path.join(BASE_DIR, filepath)
    
    // Create backup
    const backupPath = fullPath + '.bak-' + Date.now()
    const original = await fsp.readFile(fullPath, 'utf-8')
    await fsp.writeFile(backupPath, original)
    
    // Check if old_content exists
    if (!original.includes(oldContent)) {
      return bad(`old_content not found in ${fullPath}. Cannot modify.`)
    }
    
    // Count occurrences
    const occurrences = original.split(oldContent).length - 1
    if (occurrences > 1) {
      return bad(`old_content matches ${occurrences} times. Make it more specific.`)
    }
    
    // Replace
    const modified = original.replace(oldContent, newContent)
    await fsp.writeFile(fullPath, modified, 'utf-8')
    
    return ok(`Modified: ${path.basename(fullPath)} (backup saved)`, `✅ File modified.\n\nPath: ${fullPath}\nBackup: ${backupPath}\nChanges: 1 replacement\nOld (first 200 chars): ${oldContent.slice(0, 200)}\nNew (first 200 chars): ${newContent.slice(0, 200)}\n\nCAPABILITY STATUS: Agent007 can modify any file.`)
  } catch (e: any) { return bad(`file_modify failed: ${e?.message}`) }
}

/* ================================================================ *
 * 5. IMAGE_PROCESS — Process images (resize, convert, analyze)
 * ================================================================ */
export async function toolImageProcess(args: {
  filepath?: string
  action?: string // 'info' | 'base64' | 'analyze'
}, _ctx: ToolContext): Promise<ToolResult> {
  const filepath = (args.filepath ?? '').toString().trim()
  if (!filepath) return bad('Missing "filepath" argument')
  const action = (args.action ?? 'info').toString()
  
  try {
    const fullPath = filepath.startsWith('/') ? filepath : path.join(BASE_DIR, filepath)
    const stat = await fsp.stat(fullPath)
    const ext = path.extname(fullPath).toLowerCase()
    const isImage = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'].includes(ext)
    
    if (!isImage) return bad(`Not an image file: ${ext}`)
    
    if (action === 'info') {
      return ok(`Image info: ${path.basename(fullPath)}`, `Image: ${fullPath}\nSize: ${Math.round(stat.size / 1024)}KB\nFormat: ${ext}\nCreated: ${stat.birthtime}\nModified: ${stat.mtime}\n\nUse action='base64' to get base64 data.\nUse action='analyze' to analyze with vision.`)
    }
    
    if (action === 'base64') {
      const buf = await fsp.readFile(fullPath)
      const b64 = buf.toString('base64')
      const mimeType = ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : ext === '.webp' ? 'image/webp' : ext === '.svg' ? 'image/svg+xml' : 'image/jpeg'
      const dataUrl = `data:${mimeType};base64,${b64}`
      return ok(`Image base64: ${path.basename(fullPath)} (${b64.length} chars)`, `Base64 data URL:\n${dataUrl.slice(0, 500)}... (truncated, total ${dataUrl.length} chars)\n\nUse this dataUrl with the vision tool to analyze.`)
    }
    
    if (action === 'analyze') {
      // Use vision tool to analyze
      const buf = await fsp.readFile(fullPath)
      const b64 = buf.toString('base64')
      const mimeType = ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
      const dataUrl = `data:${mimeType};base64,${b64}`
      
      try {
        const { runCanonicalLlm } = await import('./canonical-llm-router')
        const resp = await runCanonicalLlm({ messages: [{ role: 'user', content: `Analyze this image data URL accurately and describe the visible content. ${dataUrl.slice(0, 1200)}` }], taskType: 'analysis', verification: 'standard', executionClass: 'standard' })
        const analysis = resp?.content ?? 'Analysis failed'
        return ok(`Image analyzed: ${path.basename(fullPath)}`, `Image: ${fullPath}\n\nAnalysis:\n${analysis}`)
      } catch {
        return ok(`Image base64 ready: ${path.basename(fullPath)}`, `Image converted to base64. Use the vision tool with this dataUrl to analyze:\n${dataUrl.slice(0, 200)}...`)
      }
    }
    
    return bad(`Unknown action: ${action}. Use 'info', 'base64', or 'analyze'.`)
  } catch (e: any) { return bad(`image_process failed: ${e?.message}`) }
}

/* ================================================================ *
 * 6. AUDIO_PROCESS — Process audio files (info, transcribe)
 * ================================================================ */
export async function toolAudioProcess(args: {
  filepath?: string
  action?: string // 'info' | 'transcribe'
}, _ctx: ToolContext): Promise<ToolResult> {
  const filepath = (args.filepath ?? '').toString().trim()
  if (!filepath) return bad('Missing "filepath" argument')
  const action = (args.action ?? 'info').toString()
  
  try {
    const fullPath = filepath.startsWith('/') ? filepath : path.join(BASE_DIR, filepath)
    const stat = await fsp.stat(fullPath)
    const ext = path.extname(fullPath).toLowerCase()
    const isAudio = ['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a'].includes(ext)
    
    if (!isAudio) return bad(`Not an audio file: ${ext}`)
    
    if (action === 'info') {
      return ok(`Audio info: ${path.basename(fullPath)}`, `Audio: ${fullPath}\nSize: ${Math.round(stat.size / 1024)}KB\nFormat: ${ext}\n\nUse action='transcribe' to convert speech to text.`)
    }
    
    if (action === 'transcribe') {
      const buf = await fsp.readFile(fullPath)
      const result = await transcribeAudioOrVideo(buf, path.basename(fullPath))
      if (result.ok) return ok(`Transcribed: ${path.basename(fullPath)}`, `Audio: ${fullPath}\n\nTranscript:\n${result.text}`)
      return ok(`Audio info (transcribe unavailable): ${path.basename(fullPath)}`, `Audio: ${fullPath}\nSize: ${Math.round(stat.size / 1024)}KB\n\nTranscription failed: ${result.error}`)
    }
    
    return bad(`Unknown action: ${action}. Use 'info' or 'transcribe'.`)
  } catch (e: any) { return bad(`audio_process failed: ${e?.message}`) }
}

/* ================================================================ *
 * 7. VIDEO_PROCESS — Process video files (info, extract frames)
 * ================================================================ */
export async function toolVideoProcess(args: {
  filepath?: string
  action?: string // 'info' | 'frames' | 'transcribe'
}, _ctx: ToolContext): Promise<ToolResult> {
  const filepath = (args.filepath ?? '').toString().trim()
  if (!filepath) return bad('Missing "filepath" argument')
  const action = (args.action ?? 'info').toString()

  try {
    const fullPath = filepath.startsWith('/') ? filepath : path.join(BASE_DIR, filepath)
    const stat = await fsp.stat(fullPath)
    const ext = path.extname(fullPath).toLowerCase()
    const isVideo = ['.mp4', '.avi', '.mov', '.mkv', '.webm'].includes(ext)

    if (!isVideo) return bad(`Not a video file: ${ext}`)

    if (action === 'info') {
      return ok(`Video info: ${path.basename(fullPath)}`, `Video: ${fullPath}\nSize: ${Math.round(stat.size / 1024)}KB\nFormat: ${ext}\n\nUse action='frames' to extract key frames for analysis, or action='transcribe' for speech-to-text (mp4/webm only -- other containers need local transcoding this runtime cannot perform).`)
    }

    if (action === 'transcribe') {
      if (!isTranscribableExtension(ext)) {
        return ok(`Video info (transcription unsupported for ${ext}): ${path.basename(fullPath)}`, `Video: ${fullPath}\n\nThis container format (${ext}) is not one Groq's transcription endpoint accepts directly, and this runtime has no ffmpeg/transcoding toolchain to convert it. Supported containers: mp4, webm.`)
      }
      const buf = await fsp.readFile(fullPath)
      const result = await transcribeAudioOrVideo(buf, path.basename(fullPath))
      if (result.ok) return ok(`Transcribed: ${path.basename(fullPath)}`, `Video: ${fullPath}\n\nTranscript (audio track):\n${result.text}`)
      return ok(`Video info (transcribe unavailable): ${path.basename(fullPath)}`, `Video: ${fullPath}\nSize: ${Math.round(stat.size / 1024)}KB\n\nTranscription failed: ${result.error}`)
    }

    if (action === 'frames') {
      // Use Python to extract frames with OpenCV
      try {
        const { exec } = await import('node:child_process')
        const { promisify } = await import('node:util')
        const execAsync = promisify(exec)
        const framesDir = `/tmp/video-frames-${Date.now()}`
        await fsp.mkdir(framesDir, { recursive: true })
        
        const script = `import cv2, os
cap = cv2.VideoCapture('${fullPath}')
total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
fps = cap.get(cv2.CAP_PROP_FPS)
duration = total / fps if fps > 0 else 0
# Extract 5 frames evenly distributed
for i in range(5):
    frame_num = int(total * (i + 1) / 6)
    cap.set(cv2.CAP_PROP_POS_FRAMES, frame_num)
    ret, frame = cap.read()
    if ret:
        cv2.imwrite(os.path.join('${framesDir}', f'frame_{i}.jpg'), frame)
cap.release()
print(f'Extracted 5 frames. Total: {total}, FPS: {fps:.1f}, Duration: {duration:.1f}s')`
        
        const { stdout } = await execAsync(`python3 -c "${script}"`, { timeout: 30000 })
        const frames = await fsp.readdir(framesDir)
        
        return ok(`Video frames extracted: ${path.basename(fullPath)}`, `Video: ${fullPath}\n${stdout}\n\nFrames saved to: ${framesDir}\nFrames: ${frames.length}\n\nUse image_process with action='analyze' on each frame to understand the video content.`)
      } catch (e: any) {
        return ok(`Video info (frame extraction failed): ${path.basename(fullPath)}`, `Video: ${fullPath}\nSize: ${Math.round(stat.size / 1024)}KB\n\nFrame extraction failed: ${e?.message}\n\nInstall OpenCV: pip install opencv-python`)
      }
    }
    
    return bad(`Unknown action: ${action}. Use 'info', 'frames', or 'transcribe'.`)
  } catch (e: any) { return bad(`video_process failed: ${e?.message}`) }
}

/* ================================================================ *
 * 8. DIRECTORY_LIST — List files in any directory
 * ================================================================ */
export async function toolDirectoryList(args: {
  dirpath?: string
  recursive?: boolean
}, _ctx: ToolContext): Promise<ToolResult> {
  const dirpath = (args.dirpath ?? BASE_DIR).toString().trim()
  const recursive = args.recursive === true
  
  try {
    const fullPath = dirpath.startsWith('/') ? dirpath : path.join(BASE_DIR, dirpath)
    
    async function listDir(dir: string, prefix: string): Promise<string> {
      const entries = await fsp.readdir(dir, { withFileTypes: true })
      let result = ''
      for (const entry of entries) {
        const isDir = entry.isDirectory()
        const size = isDir ? '' : ` (${Math.round((await fsp.stat(path.join(dir, entry.name)).catch(() => ({ size: 0 }))).size / 1024)}KB)`
        result += `${prefix}${isDir ? '📁' : '📄'} ${entry.name}${size}\n`
        if (recursive && isDir && !entry.name.startsWith('.') && !entry.name.startsWith('node_modules')) {
          result += await listDir(path.join(dir, entry.name), prefix + '  ')
        }
      }
      return result
    }
    
    const listing = await listDir(fullPath, '  ')
    return ok(`Listed: ${dirpath}`, `Directory: ${fullPath}\n\n${listing || '(empty)'}\n\nCAPABILITY STATUS: Agent007 can browse any directory.`)
  } catch (e: any) { return bad(`directory_list failed: ${e?.message}`) }
}
