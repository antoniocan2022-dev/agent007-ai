import fs from 'fs'
import path from 'path'
import { promises as fsp } from 'fs'
import type { ToolContext, ToolResult } from './tools'

const BASE_DIR = process.cwd()
function ok(preview: string, result: string): ToolResult { return { ok: true, preview, result } }
function bad(result: string): ToolResult { return { ok: false, preview: result.slice(0, 140), result } }

/* ================================================================ *
 * IMAGE_PROCESS — Process image files (info, base64, analyze)
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
    const isImage = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'].includes(ext)
    if (!isImage) return bad(`Not an image file: ${ext}`)

    if (action === 'info') {
      return ok(`Image info: ${path.basename(fullPath)}`, `Image: ${fullPath}\nSize: ${Math.round(stat.size / 1024)}KB\nFormat: ${ext}`)
    }

    if (action === 'base64') {
      const buf = await fsp.readFile(fullPath)
      const b64 = buf.toString('base64')
      const mimeType = ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : ext === '.webp' ? 'image/webp' : ext === '.svg' ? 'image/svg+xml' : 'image/jpeg'
      const dataUrl = `data:${mimeType};base64,${b64}`
      return ok(`Image base64: ${path.basename(fullPath)} (${b64.length} chars)`, `Base64 data URL:\n${dataUrl.slice(0, 500)}... (truncated, total ${dataUrl.length} chars)\n\nUse this dataUrl with the vision tool to analyze.`)
    }

    if (action === 'analyze') {
      const buf = await fsp.readFile(fullPath)
      const b64 = buf.toString('base64')
      const mimeType = ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
      const dataUrl = `data:${mimeType};base64,${b64}`
      try {
        const { runCanonicalLlm } = await import('./canonical-llm-router')
        const resp = await runCanonicalLlm({
          messages: [{ role: 'user', content: `Analyze this image data URL accurately and describe the visible content. ${dataUrl}` }],
          taskType: 'analysis',
          verification: 'standard',
          executionClass: 'standard',
        })
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
 * AUDIO_PROCESS — Process audio files (info, transcribe)
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
      try {
        const apiKey = process.env.OPENAI_API_KEY
        if (!apiKey) throw new Error('ASR requires OPENAI_API_KEY')
        const buf = await fsp.readFile(fullPath)
        const form = new FormData()
        form.append('file', new Blob([buf], { type: 'application/octet-stream' }), path.basename(fullPath))
        form.append('model', 'whisper-1')
        const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}` },
          body: form,
          signal: AbortSignal.timeout(30000),
        })
        if (!response.ok) throw new Error(`ASR failed: HTTP ${response.status}`)
        const result = await response.json()
        const transcript = result?.text || 'Transcription failed'
        return ok(`Transcribed: ${path.basename(fullPath)}`, `Audio: ${fullPath}\n\nTranscript:\n${transcript}`)
      } catch (e: any) {
        return ok(`Audio info (transcribe unavailable): ${path.basename(fullPath)}`, `Audio: ${fullPath}\nSize: ${Math.round(stat.size / 1024)}KB\n\nTranscription failed: ${e?.message}\n\nThe audio file is saved and ready for manual transcription.`)
      }
    }

    return bad(`Unknown action: ${action}. Use 'info' or 'transcribe'.`)
  } catch (e: any) { return bad(`audio_process failed: ${e?.message}`) }
}
